import {
  governedActionUnavailableReason,
  type GovernedActionDefinition,
} from './actionRegistry';
import {
  assertGovernanceCaseActionProfileCompatibility,
  CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE,
  getGovernanceCaseActionDefinition,
  isProviderAdmissionCatalogEnabled,
  listGovernanceCaseActionDefinitions,
  resolveGovernanceCaseExternalActionAdapterReadiness,
  STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
} from './governanceCaseActionComposition';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { buildExactAuthorityBindingFromProjectedGatewayBinding } from './exactActionAuthorityMaterialization';
import {
  compareExternalGovernedActionCatalogShadow,
  type ExternalGovernedActionCatalogShadowCompare,
  type ExternalGovernedActionUserReadiness,
} from './externalGovernedActionCatalogShadow';
import {
  requireResolvedExternalGovernedActionExecutionReadiness,
} from './externalGovernedActionReadiness';
import {
  assertGovernanceProfileSupportsAction,
  CIRCLE_GOVERNANCE_PROFILE_V1,
} from './governanceProfile';
import {
  resolveActiveGovernanceProfilePin,
  type GovernanceProfileWorkPin,
} from './governanceProfileLifecycle';
import {
  authorityResolutionFromBinding,
  ensureGovernedActionRuntimeSeeds,
  resolveCanonicalActionAuthorityBinding,
  resolveGovernedDecisionAuthoritySubject,
  resolvePersistedGovernedActionContractVersion,
} from './governedActionGatewayRuntime';
import {
  isKnownGovernedActionNetwork,
  resolveGovernedActionRuntimeContext,
} from './governedActionRuntimeContext';
import { governanceMandateAuthoritySourceVersion } from './governanceMandateEffects';
import { resolveSnsProviderTrustReadiness } from './snsProviderTrustProfile';
import { resolveKoraProviderTrustReadiness } from './koraProviderTrustProfile';
import { resolveSasProviderTrustReadiness } from './sasProviderTrustProfile';
import type { GovernanceSignalChainId } from './signalEnvelopeV2';

export type GovernanceCaseType =
  | 'signal'
  | 'policy'
  | 'public_asset'
  | 'program'
  | 'grant'
  | 'external_research';

export type GovernanceTemplateReadinessState =
  | 'ready'
  | 'setup_required'
  | 'degraded'
  | 'unavailable';

export type GovernanceMechanismKind =
  | 'equal_weight_threshold'
  | 'quadratic_token_weight'
  | 'quadratic_voice_credits'
  | 'quadratic_funding'
  | 'ranked_choice'
  | 'approval_voting'
  | 'conviction_voting'
  | 'optimistic_challenge'
  | 'sortition'
  | 'bicameral'
  | 'futarchy';

export interface GovernanceMechanismCatalogItem {
  kind: GovernanceMechanismKind;
  availability: 'available' | 'unavailable';
  resource: string;
  formula: string;
  sybilRisk: string;
  resultType: string;
  provider: string;
  boundaries: {
    electorate: string;
    input: string;
    resolver: string;
    finality: string;
    result: string;
  };
  identityEnforcement: null | {
    claimClass: string;
    acquisition: string;
    appeal: string;
    providerEnforcement: string;
    feePolicy: string;
  };
  reasonCodes: string[];
}

export interface GovernanceProviderReadinessItem {
  provider: 'alcheme_internal' | 'realms' | 'realms_plugin' | 'squads' | 'metadao'
    | 'solana_attestation_service' | 'trusta_risk' | 'solana_id_reputation'
    | 'kyc_uniqueness_liveness' | 'solana_name_service' | 'kora';
  availability: 'available' | 'unavailable';
  readinessState: GovernanceTemplateReadinessState;
  riskMaturity: 'stable' | 'experimental';
  registry: {
    sourceRef: 'current_governance_case_template_catalog';
    lifecycle: 'active' | 'candidate';
    capabilityRole: 'native_governance' | 'provider_governance' | 'attestation_transport'
      | 'identity_risk_signal' | 'identity_reputation_signal'
      | 'identity_kyc_uniqueness_liveness' | 'name_resolution_display_input'
      | 'fee_abstraction';
    integrationKind: 'protocol_direct' | 'protocol_direct_or_sdk_proxy'
      | 'managed_service_or_self_hosted' | 'issuer_adapter';
    network: string;
    auth: string;
    feeModel: string;
    availabilityBoundary: string;
    privacyBoundary: string;
    requiredReadback: string[];
    forbiddenMappings: string[];
    contractPortability: {
      evmDependency: 'none';
      requiredProviderKeys: string[];
      forbiddenAssumptions: string[];
      futureGate: 'required_for_new_adapter_or_reference_fixture';
    };
    authoritySeparation: {
      institutionalDecisionAuthority: 'committee_circle' | 'native_governance_policy' | 'provider_external';
      providerStageBinding: 'not_required' | 'required_only_when_committee_policy_selects_external_provider';
      bindingCondition: string;
    };
    specializedReadiness: {
      votingPowerPlugin: null | {
        registrarRef: 'required_before_activation';
        pluginProgramRef: 'required_before_activation';
        voterWeightRecord: 'required_before_activation';
        calculatedWeight: 'required_before_activation';
        updatedAt: 'required_before_activation';
        availability: 'blocked_until_verified_vsr_vwr_nft_or_existing_plugin';
        offChainContributionScore: 'requires_new_oracle_attestation_and_on_chain_plugin';
        customPluginAvailabilityClaim: 'forbidden_without_verified_program';
      };
      conditionalMarket: null | {
        provider: 'metadao';
        twap: 'required_before_use';
        liquidity: 'required_before_use';
        finalization: 'required_before_use';
        feeDisclosure: 'required_before_use';
        terminalEvidence: 'provider_native_market_outcome_required';
        alchemeTallyMode: 'forbidden';
      };
      enforcementGateway: {
        nativeSnapshotGate: 'alcheme_snapshot_gate' | 'not_applicable';
        externalProviderConsumption: 'verified_on_chain_plugin_or_gateway_required' | 'not_applicable';
        missingGatewayDisposition: 'advisory_only' | 'not_applicable';
        requiredPolicyMapping: 'weaker_or_not_representable_blocks_activation' | 'native_exact';
      };
    };
  };
  stageGate: {
    openStage: 'allowed' | 'blocked';
    execute: 'allowed' | 'blocked';
    riskConfirmation: 'not_required' | 'required';
    riskDoesNotOverrideReadiness: true;
  };
  checks: {
    program: boolean;
    version: boolean;
    ui: boolean;
    enforcement: boolean;
    finality: boolean;
    readback: boolean;
  };
  reasonCodes: string[];
}

export interface GovernanceCaseParticipationPolicy {
  admission: { source: 'circle_membership'; grantsProposalRight: false; grantsVoteRight: false };
  proposalCreation: {
    source: 'case_template_role_gate';
    eligibleRoles: ['Owner', 'Admin', 'Moderator'];
    policyRequiresRegisteredAction: true;
  };
  voterEligibility: {
    source: 'frozen_governance_snapshot';
    electorate: 'active_committee_members';
    roleGrantsExtraWeight: false;
  };
  votingPower: {
    mode: 'equal_one' | 'policy_voice_credit_budget';
    weightedVotingEnabled: false;
  };
  contribution: {
    admission: 'not_configured'; proposal: 'not_configured';
    voterEligibility: 'not_configured'; votingPower: 'not_configured';
  };
  correction: { source: 'circle_membership_correction'; appeal: 'not_available' };
}

export interface GovernanceCaseConflictOfInterestPolicy {
  disclosure: 'eligible_actor_self_disclosure';
  recusal: 'required_on_disclosure';
  electorateEffect: 'exclude_from_eligible_denominator';
  thresholdEffect: 'evaluate_frozen_rule_against_remaining_electorate';
  alternate: 'none';
  unreachable: 'block_schedule';
  publicReason: 'required';
  selfExemption: 'forbidden';
}

interface GovernanceCaseActionAuthoritySnapshotBase {
  schemaVersion: 1;
  projectionBindingId: string;
  sourceVersion: string;
  profile: {
    bindingId: string;
    versionRef: string;
    definitionDigest: string;
  };
  authorityPolicyBinding: {
    id: string;
    bindingDigest: string;
    sourceType: 'governance_mandate' | 'governance_recovery_policy' | 'circle_governance_binding';
    sourceRef: string;
    sourceVersion: string | null;
    purpose: 'collective_decision';
    limitsDigest: string;
  };
  governanceHome: { type: 'circle'; ref: string };
  committeeHome: { type: 'circle'; ref: string };
  subject: {
    type: 'circle'
      | 'circle_governance_binding'
      | 'communication_room_member'
      | 'governed_operator_capability'
      | 'external_provider'
      | 'external_app_circle_binding';
    ref: string;
  };
  action: {
    type: string;
    selector: { actionType: string | null; actionPrefix: string | null };
    riskFloor: GovernedActionDefinition['impact'];
  };
  minimumConstraints: {
    riskFloor: GovernedActionDefinition['impact'];
    minimumApprovalThreshold: number;
    minimumTimelockSeconds: number;
  };
  purpose: 'collective_decision';
  operatorSelector: {
    mode: 'not_applicable';
    reason: 'collective_decision';
  };
  executionAuthorityRequirement: {
    type: 'registered_adapter';
    adapter: string;
    executionDomain: string;
    liveReadback: 'required_before_execution';
    runtimeOwner: 'P06';
  };
  environment: 'local_development';
  network: GovernanceSignalChainId;
  policy: {
    id: string;
    versionId: string;
    version: number;
    ruleId: string;
  };
  effectiveFrom: string;
  effectiveUntil: string;
}

type GovernanceMandateCostClass =
  | 'decision'
  | 'review'
  | 'operational'
  | 'appeal'
  | 'execution';

interface GovernanceMandateCostPolicySnapshot {
  schemaVersion: 1;
  authority: 'frozen_governance_mandate_version_fee_policy';
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  policySource: 'GovernanceMandateVersion.terms.feePolicy';
  costClasses: Array<{
    costClass: GovernanceMandateCostClass;
    mode: 'no_fee' | 'capped_external_quote';
    economicBearer: 'delegator' | 'delegate' | 'shared';
    maximumAmountMinor: string | null;
    unit: string | null;
  }>;
  specialBudget: {
    mode: 'not_managed_by_mandate';
    maximumAmountMinor: string | null;
    unit: string | null;
  };
  payerAuthority: 'separate_from_governance_authority';
  payerAuthoritySeparatedFromDecisionAuthority: true;
  silentTransferToVoterOperatorExecutorAllowed: false;
  executionCostBearer: 'same_as_mandate_fee_policy';
}

export interface GovernanceCaseMandateActionAuthoritySnapshot
  extends GovernanceCaseActionAuthoritySnapshotBase {
  sourceType: 'governance_mandate';
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  mandateCostPolicy: GovernanceMandateCostPolicySnapshot;
}

export interface GovernanceCaseRecoveryActionAuthoritySnapshot
  extends GovernanceCaseActionAuthoritySnapshotBase {
  sourceType: 'governance_recovery_policy';
  mandateId: null;
  mandateVersion: null;
  mandateTermsDigest: null;
  recoveryPolicy: {
    id: string;
    trigger: 'zero_eligible_electorate';
    actorSnapshotDigest: string;
    maxCostMinor: '0';
    singleUse: true;
  };
}

export interface GovernanceCaseSelfBindingActionAuthoritySnapshot {
  schemaVersion: 1;
  sourceType: 'circle_governance_binding';
  projectionBindingId: string;
  mandateId: null;
  mandateVersion: null;
  mandateTermsDigest: null;
  sourceVersion: string;
  profile: GovernanceCaseActionAuthoritySnapshotBase['profile'];
  authorityPolicyBinding: GovernanceCaseActionAuthoritySnapshotBase['authorityPolicyBinding'] & {
    sourceType: 'circle_governance_binding';
  };
  governanceHome: { type: 'circle'; ref: string };
  committeeHome: { type: 'circle'; ref: string };
  subject: {
    type: 'circle_governance_binding' | 'external_provider' | 'external_app_circle_binding';
    ref: string;
  };
  action: GovernanceCaseActionAuthoritySnapshotBase['action'];
  minimumConstraints: {
    riskFloor: GovernedActionDefinition['impact'];
    minimumApprovalThreshold: number;
    minimumTimelockSeconds: number;
  };
  purpose: 'collective_decision';
  operatorSelector: GovernanceCaseActionAuthoritySnapshotBase['operatorSelector'];
  executionAuthorityRequirement: GovernanceCaseActionAuthoritySnapshotBase['executionAuthorityRequirement'];
  environment: 'local_development';
  network: GovernanceSignalChainId;
  policy: GovernanceCaseActionAuthoritySnapshotBase['policy'];
  effectiveFrom: string;
  effectiveUntil: string | null;
  selfBinding: {
    bindingType: 'self_governed';
    status: 'active';
  };
}

export type GovernanceCaseActionAuthoritySnapshot =
  | GovernanceCaseMandateActionAuthoritySnapshot
  | GovernanceCaseRecoveryActionAuthoritySnapshot
  | GovernanceCaseSelfBindingActionAuthoritySnapshot;

export interface GovernanceCaseInstitutionalResponsibilitySnapshot {
  schemaVersion: 1;
  sourceType: 'governance_mandate' | 'governance_recovery_policy'
    | 'circle_governance_binding' | 'system_governance_role_binding';
  sourceRef: string;
  sourceVersion: string;
  decisionAuthority: {
    type: 'governance_committee' | 'recovery_circle' | 'system_governance_role';
    ref: string;
    version: string;
  };
  caseHome: { type: string; ref: string };
  decidingCircleHome: { type: 'circle'; ref: string };
  governedSubject: { type: string; ref: string };
  mandate: null | {
    id: string;
    version: number;
    termsDigest: string;
  };
  systemRole: null | {
    domain: 'external_app';
    roleKey: string;
    environment: 'sandbox' | 'production';
  };
  recoveryPolicy?: null | {
    id: string;
    trigger: 'zero_eligible_electorate';
  };
  workflowAssignmentAuthority: 'none';
}

export function isCurrentGovernanceCaseInstitutionalResponsibility(
  value: unknown,
): value is GovernanceCaseInstitutionalResponsibilitySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, any>;
  const sourceRef = String(snapshot.sourceRef ?? '').trim();
  const sourceVersion = String(snapshot.sourceVersion ?? '').trim();
  if (
    snapshot.schemaVersion !== 1
    || !sourceRef
    || !sourceVersion
    || !snapshot.caseHome
    || !String(snapshot.caseHome.type ?? '').trim()
    || !String(snapshot.caseHome.ref ?? '').trim()
    || snapshot.decidingCircleHome?.type !== 'circle'
    || !/^[1-9]\d*$/.test(String(snapshot.decidingCircleHome.ref ?? ''))
    || !snapshot.governedSubject
    || !String(snapshot.governedSubject.type ?? '').trim()
    || !String(snapshot.governedSubject.ref ?? '').trim()
    || snapshot.decisionAuthority?.ref !== sourceRef
    || snapshot.decisionAuthority?.version !== sourceVersion
    || snapshot.workflowAssignmentAuthority !== 'none'
  ) return false;
  if (snapshot.sourceType === 'governance_mandate') {
    const mandate = snapshot.mandate;
    return snapshot.decisionAuthority.type === 'governance_committee'
      && snapshot.systemRole === null
      && snapshot.recoveryPolicy == null
      && mandate?.id === sourceRef
      && Number.isSafeInteger(mandate.version)
      && mandate.version > 0
      && /^[a-f0-9]{64}$/.test(String(mandate.termsDigest ?? ''))
      && sourceVersion === governanceMandateAuthoritySourceVersion(
        mandate.version,
        mandate.termsDigest,
      );
  }
  if (snapshot.sourceType === 'governance_recovery_policy') {
    return snapshot.decisionAuthority.type === 'recovery_circle'
      && snapshot.mandate === null
      && snapshot.systemRole === null
      && snapshot.recoveryPolicy?.id === sourceRef
      && snapshot.recoveryPolicy.trigger === 'zero_eligible_electorate'
      && snapshot.caseHome.type === 'circle';
  }
  if (snapshot.sourceType === 'circle_governance_binding') {
    return snapshot.decisionAuthority.type === 'governance_committee'
      && snapshot.mandate === null
      && snapshot.systemRole === null
      && snapshot.recoveryPolicy == null
      && snapshot.caseHome.type === 'circle'
      && (
        snapshot.governedSubject.type === 'circle_governance_binding'
        || snapshot.governedSubject.type === 'external_provider'
        || snapshot.governedSubject.type === 'external_app_circle_binding'
      );
  }
  if (snapshot.sourceType === 'system_governance_role_binding') {
    const systemRole = snapshot.systemRole;
    return snapshot.decisionAuthority.type === 'system_governance_role'
      && snapshot.mandate === null
      && snapshot.recoveryPolicy == null
      && systemRole?.domain === 'external_app'
      && Boolean(String(systemRole.roleKey ?? '').trim())
      && (systemRole.environment === 'sandbox' || systemRole.environment === 'production')
      && snapshot.caseHome.type === 'external_app_system_role'
      && snapshot.caseHome.ref === `external_app:${systemRole.environment}`;
  }
  return false;
}

export interface GovernanceCaseAuthorityResolutionInput {
  binding: {
    id: string;
    bindingType?: string;
    status?: string;
    targetAuthorizationStatus?: string;
    committeeMandateStatus?: string;
    targetCircleId: number;
    committeeCircleId: number;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    authoritySourceType?: string;
    authoritySourceRef?: string;
    authoritySourceVersion?: string | null;
    authorityPurpose?: string;
    authoritySelector?: Record<string, unknown>;
    authorityLimits?: Record<string, unknown>;
    authorityEffectiveFrom?: Date;
    authorityEffectiveUntil?: Date | null;
  };
  policy: { id: string };
  policyVersion: { id: string; version: number };
}

export const NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY: GovernanceCaseConflictOfInterestPolicy = {
  disclosure: 'eligible_actor_self_disclosure',
  recusal: 'required_on_disclosure',
  electorateEffect: 'exclude_from_eligible_denominator',
  thresholdEffect: 'evaluate_frozen_rule_against_remaining_electorate',
  alternate: 'none',
  unreachable: 'block_schedule',
  publicReason: 'required',
  selfExemption: 'forbidden',
};

export interface GovernanceCaseTemplateSelection {
  schemaVersion: 2;
  templateId: string;
  templateVersion: number;
  labelKey: string;
  caseType: GovernanceCaseType;
  readinessState: GovernanceTemplateReadinessState;
  profile: {
    bindingId: string;
    versionRef: string;
    definitionDigest: string;
  };
  participationPolicy: GovernanceCaseParticipationPolicy;
  conflictOfInterestPolicy: GovernanceCaseConflictOfInterestPolicy;
  actionContract: null | {
    actionType: string;
    contractVersionId: string;
    definitionDigest: string;
    executionAdapter: string;
    executionDomain: string;
    riskFloor: GovernedActionDefinition['impact'];
    bindingRequirement?: GovernedActionDefinition['bindingRequirement'];
  };
  actionAuthority: GovernanceCaseActionAuthoritySnapshot | null;
  institutionalResponsibility: GovernanceCaseInstitutionalResponsibilitySnapshot | null;
  decisionProvider: 'alcheme_internal';
  decisionMechanism: null | {
    kind: 'equal_weight_threshold';
    schemaId: 'alcheme.native.equal-weight-threshold';
    schemaVersion: 1;
    resolverId: 'committee.member_threshold';
    resolverVersion: '1';
    provider: 'alcheme_internal';
    availability: 'available';
  } | {
    kind: 'quadratic_voice_credits';
    schemaId: 'alcheme.native.quadratic-voice-credits';
    schemaVersion: 1;
    resolverId: 'native.quadratic_voice_credits';
    resolverVersion: '1';
    provider: 'alcheme_internal';
    availability: 'available';
    choiceSet: Array<{ id: string; label: string }>;
  } | {
    kind: 'quadratic_funding';
    schemaId: 'alcheme.native.quadratic-funding';
    schemaVersion: 1;
    resolverId: 'native.quadratic_funding';
    resolverVersion: '1';
    provider: 'alcheme_internal';
    availability: 'available';
    round: {
      roundRef: string;
      budgetUnit: string;
      matchingBudget: number;
      commitmentCapPerActorPerProject: number;
      formula: 'integer_sqrt_quadratic_matching';
      rounding: 'largest_remainder_then_project_ref';
      projects: Array<{
        id: string;
        label: string;
        projectRef: string;
        recipientRef: string;
        allocationCap: number;
      }>;
      excludedProjects: Array<{ projectRef: string; reason: string }>;
    };
  };
  selectionRanking: null | {
    candidateSnapshot: {
      source: 'human_case_intake';
      aiAuthority: 'none';
      eligibleCandidates: Array<{
        id: string;
        label: string;
        candidateRef: string;
        score: number;
      }>;
      excludedCandidates: Array<{ candidateRef: string; reason: string }>;
    };
    seatCount: number;
    scoreDirection: 'higher_integer_first';
    tieResolver: 'candidate_ref_lexicographic';
  };
  executionProvider: 'not_applicable' | 'legacy_compatibility';
  sourceProvider: 'alcheme_native_intake' | 'external_source_intake';
  executionPreparation: 'not_applicable' | 'decision_only';
  reviewPolicy: {
    reviewerReplacement: 'manager_or_current_reviewer';
    appeal: 'not_available';
    higherReviewGate: 'review_responsibility_escalation';
  };
  outcomePolicy: {
    closeSignoff: 'accepted_outcome_reviewer';
    highImpactThreshold: 'high';
    executorSeparation: 'required';
  };
  matchReasons: string[];
}

export interface GovernanceCaseTemplateCatalogItem {
  templateId: string;
  templateVersion: number;
  labelKey: string;
  supportedCaseTypes: GovernanceCaseType[];
  readinessState: GovernanceTemplateReadinessState;
  reasonCodes: string[];
}

export interface GovernanceCaseTemplateCatalog {
  profile: GovernanceCaseTemplateSelection['profile'];
  participationPolicy: GovernanceCaseParticipationPolicy | null;
  requestedCaseType: GovernanceCaseType;
  availableTemplates: GovernanceCaseTemplateCatalogItem[];
  excludedTemplates: GovernanceCaseTemplateCatalogItem[];
  actionOptions: Array<{
    actionType: string;
    executionAdapter: string;
    executionDomain: string;
    impact: string;
    readiness?: 'discoverable';
    nextStep?: 'configure_governance_binding' | 'select_subject' | 'open_case';
    userReadiness?: ExternalGovernedActionUserReadiness;
    reasonCode?: string;
  }>;
  externalActionShadowCompare?: ExternalGovernedActionCatalogShadowCompare[];
  mechanisms: GovernanceMechanismCatalogItem[];
  providerReadiness: GovernanceProviderReadinessItem[];
}

export class GovernanceCaseTemplateError extends Error {
  constructor(public statusCode: number, public code: string) {
    super(code);
    this.name = 'GovernanceCaseTemplateError';
  }
}

const TEMPLATE_DEFINITIONS: ReadonlyArray<{
  templateId: string;
  templateVersion: number;
  labelKey: string;
  profileId: string;
  supportedCaseTypes: GovernanceCaseType[];
  unavailableReason: string | null;
}> = [
  {
    templateId: 'basic-community',
    templateVersion: 2,
    labelKey: 'governance.template.basic_community',
    profileId: 'alcheme.circle.native',
    supportedCaseTypes: ['signal', 'policy', 'external_research'],
    unavailableReason: null,
  },
  {
    templateId: 'public-asset-program-authority',
    templateVersion: 1,
    labelKey: 'governance.template.public_asset_program_authority',
    profileId: 'alcheme.circle.native',
    supportedCaseTypes: ['public_asset', 'program'],
    unavailableReason: 'governed_resource_binding_provider_required_P06',
  },
  {
    templateId: 'grant-public-goods-milestone',
    templateVersion: 1,
    labelKey: 'governance.template.grant_public_goods_milestone',
    profileId: 'alcheme.grant.conformance',
    supportedCaseTypes: ['grant'],
    unavailableReason: 'grant_profile_and_provider_required_P03_P06',
  },
];

const BASIC_COMMUNITY_REVIEW_POLICY: GovernanceCaseTemplateSelection['reviewPolicy'] = {
  reviewerReplacement: 'manager_or_current_reviewer',
  appeal: 'not_available',
  higherReviewGate: 'review_responsibility_escalation',
};

const BASIC_COMMUNITY_OUTCOME_POLICY: GovernanceCaseTemplateSelection['outcomePolicy'] = {
  closeSignoff: 'accepted_outcome_reviewer',
  highImpactThreshold: 'high',
  executorSeparation: 'required',
};

const BASIC_COMMUNITY_PARTICIPATION_POLICY: GovernanceCaseParticipationPolicy = {
  admission: { source: 'circle_membership', grantsProposalRight: false, grantsVoteRight: false },
  proposalCreation: {
    source: 'case_template_role_gate',
    eligibleRoles: ['Owner', 'Admin', 'Moderator'],
    policyRequiresRegisteredAction: true,
  },
  voterEligibility: {
    source: 'frozen_governance_snapshot',
    electorate: 'active_committee_members',
    roleGrantsExtraWeight: false,
  },
  votingPower: { mode: 'equal_one', weightedVotingEnabled: false },
  contribution: {
    admission: 'not_configured',
    proposal: 'not_configured',
    voterEligibility: 'not_configured',
    votingPower: 'not_configured',
  },
  correction: { source: 'circle_membership_correction', appeal: 'not_available' },
};

const NATIVE_DECISION_MECHANISM: NonNullable<GovernanceCaseTemplateSelection['decisionMechanism']> = {
  kind: 'equal_weight_threshold',
  schemaId: 'alcheme.native.equal-weight-threshold',
  schemaVersion: 1,
  resolverId: 'committee.member_threshold',
  resolverVersion: '1',
  provider: 'alcheme_internal',
  availability: 'available',
};

const NATIVE_QV_DECISION_MECHANISM = {
  kind: 'quadratic_voice_credits',
  schemaId: 'alcheme.native.quadratic-voice-credits',
  schemaVersion: 1,
  resolverId: 'native.quadratic_voice_credits',
  resolverVersion: '1',
  provider: 'alcheme_internal',
  availability: 'available',
} as const;

const NATIVE_QF_DECISION_MECHANISM = {
  kind: 'quadratic_funding',
  schemaId: 'alcheme.native.quadratic-funding',
  schemaVersion: 1,
  resolverId: 'native.quadratic_funding',
  resolverVersion: '1',
  provider: 'alcheme_internal',
  availability: 'available',
} as const;

const COMMON_BOUNDARIES = {
  electorate: 'frozen_snapshot',
  input: 'registered_signal_schema',
  resolver: 'registered_deterministic_resolver',
  finality: 'canonical_decision_terminal_state',
  result: 'typed_result_with_digest',
};

const MECHANISM_CATALOG: ReadonlyArray<GovernanceMechanismCatalogItem> = [
  mechanism('equal_weight_threshold', 'available', 'committee_membership', 'one_member_one_vote_threshold', 'membership_admission', 'binary_decision_tally', 'alcheme_internal', []),
  mechanism('quadratic_token_weight', 'unavailable', 'token_balance_snapshot', 'sqrt_token_balance_weight', 'token_splitting_and_wealth', 'binary_or_multi_choice_tally', 'not_registered', ['token_resource_and_provider_enforcement_required_P06']),
  {
    ...mechanism('quadratic_voice_credits', 'available', 'fixed_voice_credit_budget', 'sum_squared_votes_lte_budget', 'identity_splitting', 'multi_choice_voice_credit_tally', 'alcheme_internal', [], true),
    identityEnforcement: {
      claimClass: 'active_committee_membership',
      acquisition: 'circle_membership_admission',
      appeal: 'circle_membership_correction',
      providerEnforcement: 'alcheme_membership_snapshot',
      feePolicy: 'none',
    },
  },
  {
    ...mechanism('quadratic_funding', 'available', 'signed_unsettled_commitments', 'integer_sqrt_quadratic_matching', 'donor_identity_splitting', 'allocation_plan', 'alcheme_internal', ['settlement_resource_not_bound_P06'], true),
    identityEnforcement: {
      claimClass: 'active_committee_membership',
      acquisition: 'circle_membership_admission',
      appeal: 'circle_membership_correction',
      providerEnforcement: 'alcheme_membership_snapshot',
      feePolicy: 'none',
    },
  },
  ...(['ranked_choice', 'approval_voting', 'conviction_voting', 'optimistic_challenge', 'sortition', 'bicameral', 'futarchy'] as GovernanceMechanismKind[])
    .map((kind) => mechanism(kind, 'unavailable', 'not_registered', 'not_registered', 'not_assessed', 'not_registered', 'not_registered', ['lossless_mechanism_boundary_not_registered'])),
];

const PROVIDER_READINESS: ReadonlyArray<GovernanceProviderReadinessItem> = [
  providerReadiness('alcheme_internal', true),
  providerReadiness('realms', false),
  providerReadiness('realms_plugin', false),
  providerReadiness('squads', false),
  providerReadiness('metadao', false),
  sasAttestationProviderReadiness(),
  candidateProviderReadiness('trusta_risk', {
    readinessState: 'unavailable',
    capabilityRole: 'identity_risk_signal',
    integrationKind: 'issuer_adapter',
    network: 'issuer-specific candidate; no approved production issuer binding',
    auth: 'issuer attestation/JWS/revocation trust must be configured per issuer',
    feeModel: 'issuer/API/RPC fee not approved',
    availabilityBoundary: 'risk score issuer remains candidate-only and cannot activate voter eligibility or uniqueness',
    privacyBoundary: 'risk evidence requires purpose, retention and reviewer-only detail; public projection may show only safe eligibility reason',
    requiredReadback: ['issuer_identity', 'score_model', 'evaluated_at', 'revocation_or_expiry', 'allowed_purposes'],
    forbiddenMappings: [
      'risk_score_is_not_reputation',
      'risk_score_is_not_proof_of_personhood',
      'risk_score_is_not_kyc',
    ],
    requiredProviderKeys: ['issuerRef', 'claimSchemaRef', 'jwsKeyRef', 'revocationRef'],
    authoritySeparation: candidateProviderAuthoritySeparation('not_required'),
    reasonCodes: ['provider_claim_roles_not_interchangeable_P06'],
  }),
  candidateProviderReadiness('solana_id_reputation', {
    readinessState: 'unavailable',
    capabilityRole: 'identity_reputation_signal',
    integrationKind: 'issuer_adapter',
    network: 'issuer-specific candidate; no approved production issuer binding',
    auth: 'issuer attestation/JWS/revocation trust must be configured per issuer',
    feeModel: 'issuer/API/RPC fee not approved',
    availabilityBoundary: 'reputation issuer remains candidate-only and cannot prove uniqueness or liveness',
    privacyBoundary: 'reputation evidence requires purpose, retention and reviewer-only detail; public projection may show only safe eligibility reason',
    requiredReadback: ['issuer_identity', 'reputation_model', 'evaluated_at', 'revocation_or_expiry', 'allowed_purposes'],
    forbiddenMappings: [
      'reputation_is_not_risk_score',
      'reputation_is_not_proof_of_personhood',
      'reputation_is_not_kyc',
    ],
    requiredProviderKeys: ['issuerRef', 'claimSchemaRef', 'jwsKeyRef', 'revocationRef'],
    authoritySeparation: candidateProviderAuthoritySeparation('not_required'),
    reasonCodes: ['provider_claim_roles_not_interchangeable_P06'],
  }),
  candidateProviderReadiness('kyc_uniqueness_liveness', {
    readinessState: 'unavailable',
    capabilityRole: 'identity_kyc_uniqueness_liveness',
    integrationKind: 'issuer_adapter',
    network: 'issuer-specific candidate; no approved production issuer binding',
    auth: 'issuer identity, schema, verifier role and revocation trust must be configured per issuer',
    feeModel: 'issuer/API/manual review fee not approved',
    availabilityBoundary: 'KYC/uniqueness/liveness issuer remains candidate-only until schema, nullifier/scope, consent and appeal/review lifecycle are approved',
    privacyBoundary: 'sensitive KYC fields are never public-chain schema or public Case fields; public projection may show only eligibility status and safe reason',
    requiredReadback: ['issuer_identity', 'schema_ref', 'uniqueness_scope', 'nullifier_or_subject_binding', 'liveness_time', 'revocation_or_expiry', 'consent_purpose_retention'],
    forbiddenMappings: [
      'kyc_is_not_reputation',
      'kyc_is_not_risk_score',
      'low_risk_is_not_liveness',
    ],
    requiredProviderKeys: ['issuerRef', 'schemaRef', 'verifierRoleRef', 'revocationRef', 'consentPolicyRef'],
    authoritySeparation: candidateProviderAuthoritySeparation('required_only_when_committee_policy_selects_external_provider'),
    reasonCodes: ['provider_claim_roles_not_interchangeable_P06'],
  }),
  snsDisplayProviderReadiness(),
  koraFeeAbstractionProviderReadiness(),
];

export async function resolveGovernanceCaseTemplateCatalog(
  prisma: {
    governanceProfileBinding: { findFirst(input: unknown): Promise<any> };
    circleGovernanceBinding?: { findMany(input: unknown): Promise<any[]> };
  },
  input: {
    homeIdentityBindingId: string;
    homeType: string;
    homeRef?: string;
    caseType: GovernanceCaseType;
  },
): Promise<GovernanceCaseTemplateCatalog> {
  let pin: GovernanceProfileWorkPin;
  try {
    pin = await resolveActiveGovernanceProfilePin(prisma, {
      homeIdentityBindingId: input.homeIdentityBindingId,
    });
  } catch {
    throw new GovernanceCaseTemplateError(409, 'governance_case_template_profile_required');
  }
  if (!pin.definition.supportedHomeTypes.includes(input.homeType)) {
    throw new GovernanceCaseTemplateError(409, 'governance_case_template_profile_incompatible');
  }

  const items = TEMPLATE_DEFINITIONS.map((definition): GovernanceCaseTemplateCatalogItem => {
    const reasons: string[] = [];
    if (!definition.supportedCaseTypes.includes(input.caseType)) {
      reasons.push('case_type_not_supported');
    }
    if (definition.profileId !== pin.definition.profileId) {
      reasons.push('governance_profile_not_matched');
    }
    if (definition.unavailableReason) reasons.push(definition.unavailableReason);
    return {
      templateId: definition.templateId,
      templateVersion: definition.templateVersion,
      labelKey: definition.labelKey,
      supportedCaseTypes: [...definition.supportedCaseTypes],
      readinessState: reasons.length === 0 ? 'ready' : 'unavailable',
      reasonCodes: reasons,
    };
  });

  const circleId = input.homeType === 'circle'
    ? Number(input.homeRef ?? '')
    : NaN;
  const exactBindings = (
    typeof prisma.circleGovernanceBinding?.findMany === 'function'
    && Number.isSafeInteger(circleId)
    && circleId > 0
  )
    ? await prisma.circleGovernanceBinding.findMany({
      where: {
        targetCircleId: circleId,
        status: { in: ['active', 'pending_mandate'] },
      },
    })
    : [];
  const externalActionShadowCompare: ExternalGovernedActionCatalogShadowCompare[] = [];
  const actionOptions = listGovernanceCaseActionDefinitions().flatMap((definition) => {
    if (governedActionUnavailableReason(definition)) return [];
    if (definition.bindingRequirement === 'exact_action_subject_purpose') {
      const paCatalogEnabled = definition.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
        ? isProviderAdmissionCatalogEnabled()
        : true;
      const shadow = compareExternalGovernedActionCatalogShadow({
        home: {
          homeType: input.homeType,
          homeRef: input.homeRef?.trim() || input.homeIdentityBindingId,
        },
        profilePin: pin,
        actionDefinition: definition,
        adapterAvailability: {
          deployed: paCatalogEnabled,
          enabled: paCatalogEnabled,
        },
      });
      externalActionShadowCompare.push(shadow);
      const matchingBindings = exactBindings.filter((binding: any) =>
        binding?.actionType === definition.actionType);
      const activeExact = matchingBindings.find((binding: any) =>
        binding.status === 'active'
        && binding.committeeMandateStatus === 'accepted'
        && binding.targetAuthorizationStatus === 'accepted');
      const pendingExact = matchingBindings.find((binding: any) =>
        binding.status === 'pending_mandate'
        || binding.committeeMandateStatus === 'pending'
        || binding.targetAuthorizationStatus === 'pending');
      let userReadiness = shadow.userReadiness;
      let nextStep = shadow.nextStep;
      if (shadow.userReadiness === 'configurable' || shadow.userReadiness === 'pending_authorization') {
        if (activeExact) {
          // Catalog discovery is action-level and has no selected subject. An
          // active exact binding proves only that at least one subject is
          // governed; it cannot authorize the subject of a future Case.
          userReadiness = 'pending_authorization';
          nextStep = 'select_subject';
        } else if (pendingExact) {
          userReadiness = 'pending_authorization';
          nextStep = 'configure_governance_binding';
        }
      }
      if (
        shadow.genericDiscoveryState !== 'discoverable'
        && shadow.genericDiscoveryState !== 'ready'
        && userReadiness !== 'pending_authorization'
        && userReadiness !== 'configurable'
        && userReadiness !== 'ready_for_case'
      ) {
        if (
          userReadiness === 'service_unavailable'
          || userReadiness === 'network_mismatch'
          || userReadiness === 'historical_read_only'
        ) {
          return [{
            actionType: definition.actionType,
            executionAdapter: definition.executionAdapter,
            executionDomain: definition.executionDomain,
            impact: definition.impact,
            userReadiness,
            reasonCode: shadow.reasonCode,
            nextStep,
          }];
        }
        return [];
      }
      return [{
        actionType: definition.actionType,
        executionAdapter: definition.executionAdapter,
        executionDomain: definition.executionDomain,
        impact: definition.impact,
        readiness: userReadiness === 'ready_for_case' ? undefined : 'discoverable',
        nextStep,
        userReadiness,
        reasonCode: shadow.reasonCode,
      }];
    }
    try {
      assertGovernanceCaseActionProfileCompatibility(pin.definition, {
        homeType: input.homeType,
        definition,
      });
    } catch {
      return [];
    }
    return [{
      actionType: definition.actionType,
      executionAdapter: definition.executionAdapter,
      executionDomain: definition.executionDomain,
      impact: definition.impact,
    }];
  });

  return {
    profile: profileSnapshot(pin),
    participationPolicy: items.some((item) => item.readinessState === 'ready')
      ? copyParticipationPolicy(BASIC_COMMUNITY_PARTICIPATION_POLICY)
      : null,
    requestedCaseType: input.caseType,
    availableTemplates: items.filter((item) => item.readinessState === 'ready'),
    excludedTemplates: items.filter((item) => item.readinessState !== 'ready'),
    actionOptions: input.caseType === 'policy' ? actionOptions : [],
    ...(input.caseType === 'policy' && externalActionShadowCompare.length > 0
      ? { externalActionShadowCompare }
      : {}),
    mechanisms: input.caseType === 'policy' ? MECHANISM_CATALOG.map(copyMechanism) : [],
    providerReadiness: input.caseType === 'policy' ? PROVIDER_READINESS.map(copyProviderReadiness) : [],
  };
}

export async function selectGovernanceCaseTemplateForIntake(
  prisma: {
    governanceProfileBinding: { findFirst(input: unknown): Promise<any> };
    governedActionContractVersion: {
      findUnique(input: unknown): Promise<any>;
      create(input: unknown): Promise<any>;
    };
  },
  input: {
    homeIdentityBindingId: string;
    homeType: string;
    homeRef?: string;
    caseType: GovernanceCaseType;
    templateId: string;
    actionType?: string | null;
    decisionMechanismKind?: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding' | null;
    quadraticVoiceChoices?: unknown;
    quadraticFundingRound?: unknown;
    selectionRanking?: unknown;
    targetCircleId?: number;
    subjectType?: string;
    subjectRef?: string;
    authorityResolution?: GovernanceCaseAuthorityResolutionInput | null;
    originKind: string;
    now: Date;
  },
): Promise<{ selection: GovernanceCaseTemplateSelection; digest: string }> {
  const catalog = await resolveGovernanceCaseTemplateCatalog(prisma, input);
  const template = catalog.availableTemplates.find((item) => item.templateId === input.templateId);
  if (!template) {
    throw new GovernanceCaseTemplateError(409, 'governance_case_template_unavailable');
  }
  let actionContract: GovernanceCaseTemplateSelection['actionContract'] = null;
  let authorityPolicyBinding: any = null;
  if (input.caseType === 'policy') {
    const actionType = String(input.actionType ?? '').trim();
    const definition = getGovernanceCaseActionDefinition(actionType);
    if (!definition || !catalog.actionOptions.some((item) => item.actionType === actionType)) {
      throw new GovernanceCaseTemplateError(400, 'governance_case_action_contract_required');
    }
    if (actionType === CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE && (
      input.subjectType !== 'circle'
      || input.subjectRef !== String(input.targetCircleId)
      || (input.decisionMechanismKind ?? 'equal_weight_threshold') !== 'equal_weight_threshold'
      || input.selectionRanking != null
      || input.quadraticVoiceChoices != null
      || input.quadraticFundingRound != null
    )) {
      throw new GovernanceCaseTemplateError(400, 'governance_case_document_adoption_invalid');
    }
    if (!input.authorityResolution) {
      throw new GovernanceCaseTemplateError(409, 'governance_case_mandate_authority_required');
    }
    if (!input.homeRef || input.homeRef !== String(input.targetCircleId)) {
      throw new GovernanceCaseTemplateError(409, 'governance_case_home_authority_mismatch');
    }
    const seeded = definition.bindingRequirement === 'exact_action_subject_purpose'
      ? await resolvePersistedGovernedActionContractVersion(prisma as any, {
        definition,
        now: input.now,
      })
      : await ensureGovernedActionRuntimeSeeds({
        prisma: prisma as any,
        transactionClient: true,
      }, {
        definition,
        home: { homeType: input.homeType, homeRef: input.homeRef },
        binding: input.authorityResolution.binding,
        now: input.now,
      });
    actionContract = actionContractSnapshot(definition, {
      id: seeded.contractVersionId,
      definitionDigest: seeded.contractDefinitionDigest,
    });
    const authoritySubject = resolveGovernedDecisionAuthoritySubject({
      definition,
      targetCircleId: input.targetCircleId!,
      targetType: input.subjectType!,
      targetRef: input.subjectRef!,
      binding: input.authorityResolution.binding,
    });
    const runtimeContext = resolveGovernedActionRuntimeContext({
      binding: {
        authoritySelector: input.authorityResolution.binding.authoritySelector ?? {},
      },
    });
    const selected = await resolveCanonicalActionAuthorityBinding(prisma as any, {
      home: { homeType: input.homeType, homeRef: input.homeRef },
      contractVersionId: seeded.contractVersionId,
      definition,
      targetType: authoritySubject.type,
      targetRef: authoritySubject.ref,
      purpose: 'collective_decision',
      environment: runtimeContext.environment,
      network: runtimeContext.network,
      now: input.now,
    });
    const validatedRuntimeContext = resolveGovernedActionRuntimeContext({
      binding: {
        authoritySelector: input.authorityResolution.binding.authoritySelector ?? {},
      },
      aapbSelectorNetwork: record(selected.selector).network,
    });
    if (definition.bindingRequirement === 'exact_action_subject_purpose') {
      const profilePin = await resolveActiveGovernanceProfilePin(prisma as any, {
        homeIdentityBindingId: input.homeIdentityBindingId,
      });
      try {
        requireResolvedExternalGovernedActionExecutionReadiness({
          home: { homeType: input.homeType, homeRef: input.homeRef },
          profilePin,
          actionContract: {
            actionType: actionContract.actionType,
            contractVersionId: actionContract.contractVersionId,
            definitionDigest: actionContract.definitionDigest,
            runtimeAvailability: definition.runtimeAvailability,
            unavailableReason: definition.unavailableReason,
            executionAdapter: actionContract.executionAdapter,
            impact: actionContract.riskFloor,
          },
          subject: authoritySubject,
          purpose: 'collective_decision',
          governanceBinding: input.authorityResolution.binding,
          authorityBinding: selected,
          runtimeContext: validatedRuntimeContext,
          adapterReadiness: resolveGovernanceCaseExternalActionAdapterReadiness(
            definition,
            validatedRuntimeContext.network,
          ),
          now: input.now,
        });
      } catch (error) {
        throw new GovernanceCaseTemplateError(
          409,
          error instanceof Error ? error.message : 'governed_action_execution_not_ready',
        );
      }
    }
    authorityPolicyBinding = {
      ...selected,
      resolved: authorityResolutionFromBinding(selected),
    };
  } else if (input.actionType) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_action_contract_not_applicable');
  }
  const actionAuthority = input.caseType === 'policy'
    ? buildGovernanceCaseActionAuthoritySnapshot({
        homeIdentityBindingId: input.homeIdentityBindingId,
        targetCircleId: input.targetCircleId,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        actionContract,
        profile: catalog.profile,
        authorityPolicyBinding,
        authorityResolution: input.authorityResolution,
        now: input.now,
      })
    : null;
  const decisionMechanism = input.caseType === 'policy'
    ? selectNativeDecisionMechanism(
      input.decisionMechanismKind,
      input.quadraticVoiceChoices,
      input.quadraticFundingRound,
    )
    : null;
  const selectionRanking = input.caseType === 'policy'
    ? normalizeSelectionRanking(input.selectionRanking, decisionMechanism)
    : null;
  const selection: GovernanceCaseTemplateSelection = {
    schemaVersion: 2,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    labelKey: template.labelKey,
    caseType: input.caseType,
    readinessState: 'ready',
    profile: catalog.profile,
    participationPolicy: {
      ...copyParticipationPolicy(BASIC_COMMUNITY_PARTICIPATION_POLICY),
      votingPower: {
        mode: decisionMechanism?.kind === 'quadratic_voice_credits'
          ? 'policy_voice_credit_budget'
          : 'equal_one',
        weightedVotingEnabled: false,
      },
    },
    conflictOfInterestPolicy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
    actionContract,
    actionAuthority,
    institutionalResponsibility: actionAuthority?.sourceType === 'governance_mandate'
      ? {
          schemaVersion: 1,
          sourceType: 'governance_mandate',
          sourceRef: actionAuthority.mandateId,
          sourceVersion: actionAuthority.sourceVersion,
          decisionAuthority: {
            type: 'governance_committee',
            ref: actionAuthority.mandateId,
            version: actionAuthority.sourceVersion,
          },
          caseHome: { ...actionAuthority.governanceHome },
          decidingCircleHome: { ...actionAuthority.committeeHome },
          governedSubject: { ...actionAuthority.subject },
          mandate: {
            id: actionAuthority.mandateId,
            version: actionAuthority.mandateVersion,
            termsDigest: actionAuthority.mandateTermsDigest,
          },
          systemRole: null,
          workflowAssignmentAuthority: 'none',
        }
      : actionAuthority?.sourceType === 'governance_recovery_policy'
        ? {
            schemaVersion: 1,
            sourceType: 'governance_recovery_policy',
            sourceRef: actionAuthority.recoveryPolicy.id,
            sourceVersion: actionAuthority.sourceVersion,
            decisionAuthority: {
              type: 'recovery_circle',
              ref: actionAuthority.recoveryPolicy.id,
              version: actionAuthority.sourceVersion,
            },
            caseHome: { ...actionAuthority.governanceHome },
            decidingCircleHome: { ...actionAuthority.committeeHome },
            governedSubject: { ...actionAuthority.subject },
            mandate: null,
            systemRole: null,
            recoveryPolicy: {
              id: actionAuthority.recoveryPolicy.id,
              trigger: actionAuthority.recoveryPolicy.trigger,
            },
            workflowAssignmentAuthority: 'none',
          }
      : actionAuthority?.sourceType === 'circle_governance_binding'
        ? {
            schemaVersion: 1,
            sourceType: 'circle_governance_binding',
            sourceRef: actionAuthority.projectionBindingId,
            sourceVersion: actionAuthority.sourceVersion,
            decisionAuthority: {
              type: 'governance_committee',
              ref: actionAuthority.projectionBindingId,
              version: actionAuthority.sourceVersion,
            },
            caseHome: { ...actionAuthority.governanceHome },
            decidingCircleHome: { ...actionAuthority.committeeHome },
            governedSubject: { ...actionAuthority.subject },
            mandate: null,
            systemRole: null,
            recoveryPolicy: null,
            workflowAssignmentAuthority: 'none',
          }
      : null,
    decisionProvider: 'alcheme_internal',
    decisionMechanism,
    selectionRanking,
    executionProvider: 'not_applicable',
    sourceProvider: sourceProvider(input.originKind),
    executionPreparation: input.caseType === 'policy' ? 'decision_only' : 'not_applicable',
    reviewPolicy: BASIC_COMMUNITY_REVIEW_POLICY,
    outcomePolicy: BASIC_COMMUNITY_OUTCOME_POLICY,
    matchReasons: ['case_type_matched', 'governance_profile_matched', 'provider_ready'],
  };
  return { selection, digest: governanceCaseTemplateSelectionDigest(selection) };
}

export function selectGovernanceCaseTemplateForInvocation(input: {
  definition: GovernedActionDefinition;
  profileBindingId: string;
  profileVersionRef: string;
  profileDefinitionDigest: string;
  contractVersionId: string;
  contractDefinitionDigest: string;
  home: { type: string; ref: string };
  governedSubject: { type: string; ref: string };
  authority: {
    sourceType?: string;
    sourceRef?: string;
    sourceVersion?: string | null;
    selector?: Record<string, unknown>;
    limits?: Record<string, unknown>;
  };
  scope: { type: string; ref: string };
}): { selection: GovernanceCaseTemplateSelection; digest: string } {
  const selection: GovernanceCaseTemplateSelection = {
    schemaVersion: 2,
    templateId: 'basic-community',
    templateVersion: 2,
    labelKey: 'governance.template.basic_community',
    caseType: 'policy',
    readinessState: 'ready',
    profile: {
      bindingId: input.profileBindingId,
      versionRef: input.profileVersionRef,
      definitionDigest: input.profileDefinitionDigest,
    },
    participationPolicy: copyParticipationPolicy(BASIC_COMMUNITY_PARTICIPATION_POLICY),
    conflictOfInterestPolicy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
    actionContract: actionContractSnapshot(input.definition, {
      id: input.contractVersionId,
      definitionDigest: input.contractDefinitionDigest,
    }),
    actionAuthority: null,
    institutionalResponsibility: institutionalResponsibilityForInvocation(input),
    decisionProvider: 'alcheme_internal',
    decisionMechanism: { ...NATIVE_DECISION_MECHANISM },
    selectionRanking: null,
    executionProvider: 'legacy_compatibility',
    sourceProvider: 'alcheme_native_intake',
    executionPreparation: 'decision_only',
    reviewPolicy: BASIC_COMMUNITY_REVIEW_POLICY,
    outcomePolicy: BASIC_COMMUNITY_OUTCOME_POLICY,
    matchReasons: ['invocation_contract_pinned', 'governance_profile_matched', 'legacy_provider_ready'],
  };
  return { selection, digest: governanceCaseTemplateSelectionDigest(selection) };
}

function institutionalResponsibilityForInvocation(input: {
  home: { type: string; ref: string };
  governedSubject: { type: string; ref: string };
  authority: {
    sourceType?: string;
    sourceRef?: string;
    sourceVersion?: string | null;
    selector?: Record<string, unknown>;
    limits?: Record<string, unknown>;
  };
  scope: { type: string; ref: string };
}): GovernanceCaseInstitutionalResponsibilitySnapshot | null {
  const sourceType = input.authority.sourceType;
  const sourceRef = String(input.authority.sourceRef ?? '').trim();
  const sourceVersion = String(input.authority.sourceVersion ?? '').trim();
  if (sourceType === 'governance_mandate') {
    const limits = input.authority.limits ?? {};
    const mandateId = String(limits.mandateId ?? '').trim();
    const mandateVersion = Number(limits.mandateVersion);
    const termsDigest = String(limits.mandateTermsDigest ?? '').trim();
    const targetCircleId = Number(limits.targetCircleId);
    const committeeCircleId = Number(limits.committeeCircleId);
    if (
      !sourceRef
      || sourceRef !== mandateId
      || !Number.isSafeInteger(mandateVersion)
      || mandateVersion <= 0
      || !/^[a-f0-9]{64}$/.test(termsDigest)
      || sourceVersion !== governanceMandateAuthoritySourceVersion(
        mandateVersion,
        termsDigest,
      )
      || input.home.type !== 'circle'
      || input.home.ref !== String(targetCircleId)
      || input.scope.type !== 'circle_governance_committee'
      || input.scope.ref !== String(committeeCircleId)
    ) {
      throw new Error('governance_case_mandate_institutional_responsibility_mismatch');
    }
    return {
      schemaVersion: 1,
      sourceType,
      sourceRef,
      sourceVersion,
      decisionAuthority: {
        type: 'governance_committee',
        ref: sourceRef,
        version: sourceVersion,
      },
      caseHome: { ...input.home },
      decidingCircleHome: { type: 'circle', ref: String(committeeCircleId) },
      governedSubject: { ...input.governedSubject },
      mandate: { id: mandateId, version: mandateVersion, termsDigest },
      systemRole: null,
      workflowAssignmentAuthority: 'none',
    };
  }
  if (sourceType === 'system_governance_role_binding') {
    const selector = input.authority.selector ?? {};
    const environment = selector.systemEnvironment;
    const reviewCircleId = Number(selector.reviewCircleId);
    const roleKey = String(selector.roleKey ?? '').trim();
    if (
      !sourceRef
      || !sourceVersion
      || (environment !== 'sandbox' && environment !== 'production')
      || !Number.isSafeInteger(reviewCircleId)
      || reviewCircleId <= 0
      || !roleKey
      || input.home.type !== 'external_app_system_role'
      || input.home.ref !== `external_app:${environment}`
      || input.scope.type !== 'external_app_review_circle'
      || input.scope.ref !== String(reviewCircleId)
    ) {
      throw new Error('governance_case_system_role_institutional_responsibility_mismatch');
    }
    return {
      schemaVersion: 1,
      sourceType,
      sourceRef,
      sourceVersion,
      decisionAuthority: {
        type: 'system_governance_role',
        ref: sourceRef,
        version: sourceVersion,
      },
      caseHome: { ...input.home },
      decidingCircleHome: { type: 'circle', ref: String(reviewCircleId) },
      governedSubject: { ...input.governedSubject },
      mandate: null,
      systemRole: { domain: 'external_app', roleKey, environment },
      workflowAssignmentAuthority: 'none',
    };
  }
  return null;
}

export function isGovernanceCaseType(value: unknown): value is GovernanceCaseType {
  return value === 'signal'
    || value === 'policy'
    || value === 'public_asset'
    || value === 'program'
    || value === 'grant'
    || value === 'external_research';
}

export function assertGovernanceCaseTemplateProposer(
  selection: GovernanceCaseTemplateSelection,
  actorRole: unknown,
): void {
  const role = typeof actorRole === 'string' ? actorRole.trim() : '';
  if (!selection.participationPolicy.proposalCreation.eligibleRoles.some((eligible) => eligible === role)) {
    throw new GovernanceCaseTemplateError(403, 'governance_case_proposer_not_eligible');
  }
}

function actionContractSnapshot(
  definition: GovernedActionDefinition,
  contract: { id: string; definitionDigest: string },
): NonNullable<GovernanceCaseTemplateSelection['actionContract']> {
  return {
    actionType: definition.actionType,
    contractVersionId: contract.id,
    definitionDigest: contract.definitionDigest,
    executionAdapter: definition.executionAdapter,
    executionDomain: definition.executionDomain,
    riskFloor: definition.impact,
    ...(definition.bindingRequirement
      ? { bindingRequirement: definition.bindingRequirement }
      : {}),
  };
}

function profileSnapshot(pin: GovernanceProfileWorkPin): GovernanceCaseTemplateSelection['profile'] {
  return {
    bindingId: pin.profileBindingId,
    versionRef: pin.profileVersionRef,
    definitionDigest: pin.profileDefinitionDigest,
  };
}

function sourceProvider(originKind: string): GovernanceCaseTemplateSelection['sourceProvider'] {
  return originKind === 'public_url' || originKind === 'external_proposal'
    ? 'external_source_intake'
    : 'alcheme_native_intake';
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function selectNativeDecisionMechanism(
  kind: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding' | null | undefined,
  rawChoices: unknown,
  rawFundingRound: unknown,
): NonNullable<GovernanceCaseTemplateSelection['decisionMechanism']> {
  if (kind == null || kind === 'equal_weight_threshold') {
    if (rawChoices != null || rawFundingRound != null) {
      throw new GovernanceCaseTemplateError(400, 'governance_case_qv_choices_not_applicable');
    }
    return { ...NATIVE_DECISION_MECHANISM };
  }
  if (kind === 'quadratic_funding') {
    if (rawChoices != null) {
      throw new GovernanceCaseTemplateError(400, 'governance_case_qv_choices_not_applicable');
    }
    return { ...NATIVE_QF_DECISION_MECHANISM, round: normalizeQuadraticFundingRound(rawFundingRound) };
  }
  if (kind !== 'quadratic_voice_credits' || rawFundingRound != null) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_decision_mechanism_invalid');
  }
  if (!Array.isArray(rawChoices) || rawChoices.length < 2 || rawChoices.length > 20) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_qv_choice_set_invalid');
  }
  const labels = rawChoices.map((choice) => String(choice ?? '').trim());
  if (
    labels.some((label) => label.length < 1 || label.length > 120)
    || new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length
  ) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_qv_choice_set_invalid');
  }
  return {
    ...NATIVE_QV_DECISION_MECHANISM,
    choiceSet: labels.map((label, index) => ({
      id: `choice-${index + 1}`,
      label,
    })),
  };
}

function normalizeQuadraticFundingRound(value: unknown): Extract<
  NonNullable<GovernanceCaseTemplateSelection['decisionMechanism']>,
  { kind: 'quadratic_funding' }
>['round'] {
  const round = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const roundRef = boundedText(round.roundRef, 3, 96);
  const budgetUnit = boundedText(round.budgetUnit, 1, 32);
  const matchingBudget = positiveSafeInteger(round.matchingBudget);
  const commitmentCapPerActorPerProject = positiveSafeInteger(
    round.commitmentCapPerActorPerProject,
  );
  const rawProjects = Array.isArray(round.projects) ? round.projects : [];
  const projects = rawProjects.map((item, index) => {
    const project = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    return {
      id: `project-${index + 1}`,
      label: boundedText(project.label, 1, 120),
      projectRef: boundedText(project.projectRef, 1, 128),
      recipientRef: boundedText(project.recipientRef, 1, 128),
      allocationCap: positiveSafeInteger(project.allocationCap),
    };
  });
  const rawExcluded = Array.isArray(round.excludedProjects) ? round.excludedProjects : [];
  const excludedProjects = rawExcluded.map((item) => {
    const project = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    return {
      projectRef: boundedText(project.projectRef, 1, 128),
      reason: boundedText(project.reason, 3, 240),
    };
  });
  if (
    !roundRef || !budgetUnit || !matchingBudget || !commitmentCapPerActorPerProject
    || projects.length < 2 || projects.length > 20
    || new Set(projects.map((project) => project.projectRef)).size !== projects.length
    || projects.some((project) => project.allocationCap > matchingBudget)
    || excludedProjects.length > 20
    || excludedProjects.some((project) => projects.some((eligible) => eligible.projectRef === project.projectRef))
  ) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_qf_round_invalid');
  }
  return {
    roundRef,
    budgetUnit,
    matchingBudget,
    commitmentCapPerActorPerProject,
    formula: 'integer_sqrt_quadratic_matching',
    rounding: 'largest_remainder_then_project_ref',
    projects,
    excludedProjects,
  };
}

function normalizeSelectionRanking(
  value: unknown,
  decisionMechanism: GovernanceCaseTemplateSelection['decisionMechanism'],
): GovernanceCaseTemplateSelection['selectionRanking'] {
  if (value == null) return null;
  if (decisionMechanism?.kind !== 'equal_weight_threshold') {
    throw new GovernanceCaseTemplateError(400, 'governance_case_selection_ranking_mechanism_invalid');
  }
  const selection = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (
    selection.aiAuthority != null && selection.aiAuthority !== 'none'
    || selection.source != null && selection.source !== 'human_case_intake'
  ) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_selection_ranking_ai_authority_forbidden');
  }
  const rawCandidates = Array.isArray(selection.candidates) ? selection.candidates : [];
  const eligibleCandidates = rawCandidates.map((item, index) => {
    const candidate = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    return {
      id: `candidate-${index + 1}`,
      label: boundedText(candidate.label, 1, 120),
      candidateRef: boundedText(candidate.candidateRef, 1, 128),
      score: nonNegativeSafeInteger(candidate.score),
    };
  });
  const rawExcluded = Array.isArray(selection.excludedCandidates)
    ? selection.excludedCandidates
    : [];
  const excludedCandidates = rawExcluded.map((item) => {
    const candidate = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    return {
      candidateRef: boundedText(candidate.candidateRef, 1, 128),
      reason: boundedText(candidate.reason, 3, 240),
    };
  });
  const seatCount = positiveSafeInteger(selection.seatCount);
  const allRefs = [
    ...eligibleCandidates.map((candidate) => candidate.candidateRef),
    ...excludedCandidates.map((candidate) => candidate.candidateRef),
  ];
  if (
    eligibleCandidates.length < 2 || eligibleCandidates.length > 50
    || excludedCandidates.length > 50
    || !seatCount || seatCount > eligibleCandidates.length
    || eligibleCandidates.some((candidate) => !candidate.label || !candidate.candidateRef || candidate.score < 0)
    || excludedCandidates.some((candidate) => !candidate.candidateRef || !candidate.reason)
    || new Set(allRefs).size !== allRefs.length
  ) {
    throw new GovernanceCaseTemplateError(400, 'governance_case_selection_ranking_invalid');
  }
  return {
    candidateSnapshot: {
      source: 'human_case_intake',
      aiAuthority: 'none',
      eligibleCandidates,
      excludedCandidates,
    },
    seatCount,
    scoreDirection: 'higher_integer_first',
    tieResolver: 'candidate_ref_lexicographic',
  };
}

function boundedText(value: unknown, min: number, max: number): string {
  const normalized = String(value ?? '').trim();
  return normalized.length >= min && normalized.length <= max ? normalized : '';
}

function positiveSafeInteger(value: unknown): number {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function nonNegativeSafeInteger(value: unknown): number {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : -1;
}

export function governanceCaseTemplateSelectionDigest(
  selection: GovernanceCaseTemplateSelection,
): string {
  return hashCanonicalGovernanceValue('alcheme.governance.case-template-selection', selection);
}

export function governanceCaseActionAuthorityMatchesResolution(input: {
  snapshot: GovernanceCaseActionAuthoritySnapshot | null | undefined;
  homeIdentityBindingId: string;
  targetCircleId: number;
  subjectType: string;
  subjectRef: string;
  actionContract: GovernanceCaseTemplateSelection['actionContract'];
  authorityResolution: GovernanceCaseAuthorityResolutionInput | null | undefined;
  now: Date;
}): boolean {
  try {
    const definition = input.actionContract
      ? getGovernanceCaseActionDefinition(input.actionContract.actionType)
      : null;
    if (input.snapshot?.sourceType === 'governance_mandate'
      && definition?.bindingRequirement === 'exact_action_subject_purpose') {
      const binding = input.authorityResolution?.binding;
      if (!binding || !input.actionContract) return false;
      // Exact bindings are persisted by this canonical materializer. The live
      // mandate projection also contains descriptive/operator fields that are
      // deliberately not in that record; spreading them changes its digest.
      const authority = buildExactAuthorityBindingFromProjectedGatewayBinding({
        home: { homeType: 'circle', homeRef: String(input.targetCircleId) },
        binding,
        definition,
        contractVersionId: input.actionContract.contractVersionId,
        now: input.now,
      });
      const expected = buildGovernanceCaseActionAuthoritySnapshot({
        ...input,
        profile: input.snapshot.profile,
        authorityPolicyBinding: { ...authority, resolved: authorityResolutionFromBinding(authority) },
      });
      return hashCanonicalGovernanceValue('alcheme.governance.case-action-authority', input.snapshot)
        === hashCanonicalGovernanceValue('alcheme.governance.case-action-authority', expected);
    }
    if (input.snapshot?.sourceType === 'circle_governance_binding') {
      const resolution = input.authorityResolution;
      const binding = resolution?.binding;
      if (!binding) return false;
      const authorityPolicyBinding = input.snapshot.authorityPolicyBinding;
      const exactSelfGovernedSubject = input.snapshot.subject.type !== 'circle_governance_binding';
      const expected = buildGovernanceCaseActionAuthoritySnapshot({
        ...input,
        profile: input.snapshot.profile,
        authorityPolicyBinding: {
          ...authorityPolicyBinding,
          effectiveFrom: input.snapshot.effectiveFrom,
          effectiveUntil: exactSelfGovernedSubject ? input.snapshot.effectiveUntil : null,
          selector: exactSelfGovernedSubject
            ? {
                ...(binding.authoritySelector ?? {}),
                actionType: input.snapshot.action.type,
                actionPrefix: input.snapshot.action.selector.actionPrefix,
                subjectType: input.snapshot.subject.type,
                subjectRef: input.snapshot.subject.ref,
                environment: input.snapshot.environment,
                network: input.snapshot.network,
                targetCircleId: input.targetCircleId,
              }
            : {
                actionType: input.snapshot.action.type,
                environment: input.snapshot.environment,
                network: input.snapshot.network,
                targetCircleId: input.targetCircleId,
              },
          limits: {
            ...(binding.authorityLimits ?? {}),
            policyId: input.snapshot.policy.id,
            policyVersionId: input.snapshot.policy.versionId,
            policyVersion: input.snapshot.policy.version,
            ruleId: input.snapshot.policy.ruleId,
            committeeCircleId: Number(input.snapshot.committeeHome.ref),
            domainBindingId: input.snapshot.projectionBindingId,
            riskFloor: input.snapshot.action.riskFloor,
            ...(exactSelfGovernedSubject
              ? {
                  minimumApprovalThreshold:
                    input.snapshot.minimumConstraints.minimumApprovalThreshold,
                  minimumTimelockSeconds:
                    input.snapshot.minimumConstraints.minimumTimelockSeconds,
                  effectiveFrom: input.snapshot.effectiveFrom,
                  effectiveUntil: input.snapshot.effectiveUntil,
                }
              : {}),
            executionAuthority: {
              type: input.snapshot.executionAuthorityRequirement.type,
              ref: input.snapshot.executionAuthorityRequirement.adapter,
            },
          },
          resolved: {
            sourceType: authorityPolicyBinding.sourceType,
            sourceRef: authorityPolicyBinding.sourceRef,
            sourceVersion: authorityPolicyBinding.sourceVersion,
            selectorDigest: authorityPolicyBinding.bindingDigest,
            capabilityDigest: authorityPolicyBinding.limitsDigest,
          },
        },
      });
      return hashCanonicalGovernanceValue(
        'alcheme.governance.case-action-authority',
        input.snapshot,
      ) === hashCanonicalGovernanceValue(
        'alcheme.governance.case-action-authority',
        expected,
      );
    }
    if (input.snapshot?.sourceType === 'governance_recovery_policy') {
      const resolution = input.authorityResolution;
      const binding = resolution?.binding;
      if (!binding) return false;
      const authorityPolicyBinding = input.snapshot.authorityPolicyBinding;
      const expected = buildGovernanceCaseActionAuthoritySnapshot({
        ...input,
        profile: input.snapshot.profile,
        authorityPolicyBinding: {
          ...authorityPolicyBinding,
          effectiveFrom: input.snapshot.effectiveFrom,
          effectiveUntil: input.snapshot.effectiveUntil,
          selector: {
            ...(binding.authoritySelector ?? {}),
            actionType: input.snapshot.action.type,
            environment: input.snapshot.environment,
            network: input.snapshot.network,
            targetCircleId: input.targetCircleId,
          },
          limits: {
            ...(binding.authorityLimits ?? {}),
            policyId: input.snapshot.policy.id,
            policyVersionId: input.snapshot.policy.versionId,
            policyVersion: input.snapshot.policy.version,
            ruleId: input.snapshot.policy.ruleId,
            committeeCircleId: Number(input.snapshot.committeeHome.ref),
            domainBindingId: input.snapshot.projectionBindingId,
            riskFloor: input.snapshot.action.riskFloor,
            executionAuthority: {
              type: input.snapshot.executionAuthorityRequirement.type,
              ref: input.snapshot.executionAuthorityRequirement.adapter,
            },
          },
          resolved: {
            sourceType: authorityPolicyBinding.sourceType,
            sourceRef: authorityPolicyBinding.sourceRef,
            sourceVersion: authorityPolicyBinding.sourceVersion,
            selectorDigest: authorityPolicyBinding.bindingDigest,
            capabilityDigest: authorityPolicyBinding.limitsDigest,
          },
        },
      });
      return hashCanonicalGovernanceValue(
        'alcheme.governance.case-action-authority',
        input.snapshot,
      ) === hashCanonicalGovernanceValue(
        'alcheme.governance.case-action-authority',
        expected,
      );
    }
    const expected = buildGovernanceCaseActionAuthoritySnapshot({
      ...input,
      profile: input.snapshot?.profile,
      authorityPolicyBinding: input.snapshot?.authorityPolicyBinding
        ? {
            ...input.snapshot.authorityPolicyBinding,
            effectiveFrom: input.snapshot.effectiveFrom,
            effectiveUntil: input.snapshot.effectiveUntil,
            selector: {
              ...(input.authorityResolution?.binding.authoritySelector ?? {}),
              actionType: input.snapshot.action.type,
              actionPrefix: input.snapshot.action.selector.actionPrefix,
              subjectType: 'circle',
              subjectRef: String(input.targetCircleId),
              environment: input.snapshot.environment,
              network: input.snapshot.network,
              targetCircleId: input.targetCircleId,
            },
            limits: {
              ...(input.authorityResolution?.binding.authorityLimits ?? {}),
              mandateId: input.snapshot.mandateId,
              mandateVersion: input.snapshot.mandateVersion,
              mandateTermsDigest: input.snapshot.mandateTermsDigest,
              targetCircleId: input.targetCircleId,
              domainBindingId: input.snapshot.projectionBindingId,
              policyId: input.snapshot.policy.id,
              policyVersionId: input.snapshot.policy.versionId,
              policyVersion: input.snapshot.policy.version,
              ruleId: input.snapshot.policy.ruleId,
              committeeCircleId: Number(input.snapshot.committeeHome.ref),
              riskFloor: input.snapshot.action.riskFloor,
              minimumApprovalThreshold:
                input.snapshot.minimumConstraints.minimumApprovalThreshold,
              minimumTimelockSeconds:
                input.snapshot.minimumConstraints.minimumTimelockSeconds,
              effectiveFrom: input.snapshot.effectiveFrom,
              effectiveUntil: input.snapshot.effectiveUntil,
              executionAuthority: {
                type: input.snapshot.executionAuthorityRequirement.type,
                ref: input.snapshot.executionAuthorityRequirement.adapter,
              },
            },
            resolved: {
              sourceType: input.snapshot.authorityPolicyBinding.sourceType,
              sourceRef: input.snapshot.authorityPolicyBinding.sourceRef,
              sourceVersion: input.snapshot.authorityPolicyBinding.sourceVersion,
              selectorDigest: input.snapshot.authorityPolicyBinding.bindingDigest,
              capabilityDigest: input.snapshot.authorityPolicyBinding.limitsDigest,
            },
          }
        : null,
    });
    return hashCanonicalGovernanceValue(
      'alcheme.governance.case-action-authority',
      input.snapshot,
    ) === hashCanonicalGovernanceValue(
      'alcheme.governance.case-action-authority',
      expected,
    );
  } catch {
    return false;
  }
}

function buildGovernanceCaseActionAuthoritySnapshot(input: {
  homeIdentityBindingId: string;
  targetCircleId?: number;
  subjectType?: string;
  subjectRef?: string;
  actionContract: GovernanceCaseTemplateSelection['actionContract'];
  profile?: GovernanceCaseTemplateSelection['profile'] | null;
  authorityPolicyBinding?: any;
  authorityResolution?: GovernanceCaseAuthorityResolutionInput | null;
  now: Date;
}): GovernanceCaseActionAuthoritySnapshot {
  const resolution = input.authorityResolution;
  const binding = resolution?.binding;
  const profile = input.profile;
  const authorityPolicyBinding = input.authorityPolicyBinding;
  const authoritySelector = record(authorityPolicyBinding?.selector);
  const authorityLimits = record(authorityPolicyBinding?.limits);
  const executionAuthority = record(authorityLimits.executionAuthority);
  const resolvedAuthority = record(authorityPolicyBinding?.resolved);
  const recomputedAuthority = authorityPolicyBinding
    ? authorityResolutionFromBinding(authorityPolicyBinding)
    : null;
  const selector = binding?.authoritySelector ?? {};
  const limits = binding?.authorityLimits ?? {};
  const actionType = input.actionContract?.actionType ?? '';
  const actionSelector = typeof selector.actionType === 'string' ? selector.actionType : null;
  const actionPrefix = typeof selector.actionPrefix === 'string' ? selector.actionPrefix : null;
  const mandateVersion = Number(limits.mandateVersion);
  const mandateTermsDigest = String(limits.mandateTermsDigest ?? '');
  const bindingRecord = record(binding);
  const mandateFeePolicy = record(
    record(record(bindingRecord.mandate).versions?.[0]).terms?.feePolicy,
  );
  const minimumRiskFloor = String(limits.riskFloor ?? '');
  const minimumApprovalThreshold = Number(limits.minimumApprovalThreshold);
  const minimumTimelockSeconds = Number(limits.minimumTimelockSeconds);
  const effectiveFrom = new Date(String(limits.effectiveFrom ?? 'invalid'));
  const effectiveUntil = new Date(String(limits.effectiveUntil ?? 'invalid'));
  const authorityEffectiveFrom = new Date(String(authorityPolicyBinding?.effectiveFrom ?? 'invalid'));
  const authorityEffectiveUntil = new Date(String(authorityPolicyBinding?.effectiveUntil ?? 'invalid'));
  const expectedAuthorityRiskFloor = input.actionContract
    ? stricterCaseRiskFloor(
        input.actionContract.riskFloor,
        minimumRiskFloor as GovernedActionDefinition['impact'],
      )
    : null;
  const exactActionRequired = getGovernanceCaseActionDefinition(actionType)
    ?.bindingRequirement === 'exact_action_subject_purpose';
  const selectorMatches = exactActionRequired
    ? actionSelector === actionType && actionPrefix == null
    : actionSelector === actionType
      || Boolean(actionPrefix && (actionType === actionPrefix || actionType.startsWith(`${actionPrefix}.`)));
  if (binding?.authoritySourceType === 'governance_recovery_policy') {
    const recoveryPolicyId = String(limits.recoveryPolicyId ?? '');
    const actorSnapshotDigest = String(limits.actorSnapshotDigest ?? '');
    const minimumApprovalThreshold = Number(limits.minimumApprovalThreshold);
    const minimumTimelockSeconds = Number(limits.minimumTimelockSeconds);
    const effectiveFrom = new Date(String(limits.effectiveFrom ?? 'invalid'));
    const effectiveUntil = new Date(String(limits.effectiveUntil ?? 'invalid'));
    const authorityEffectiveFrom = new Date(String(authorityPolicyBinding?.effectiveFrom ?? 'invalid'));
    const authorityEffectiveUntil = new Date(String(authorityPolicyBinding?.effectiveUntil ?? 'invalid'));
    const resolvedAuthority = record(authorityPolicyBinding?.resolved);
    const recomputedAuthority = authorityPolicyBinding
      ? authorityResolutionFromBinding(authorityPolicyBinding)
      : null;
    if (
      !input.actionContract
      || !profile
      || !authorityPolicyBinding
      || !Number.isSafeInteger(input.targetCircleId)
      || input.targetCircleId! <= 0
      || input.subjectType !== 'circle_governance_binding'
      || input.subjectRef !== binding.id
      || binding.targetCircleId !== input.targetCircleId
      || !recoveryPolicyId
      || binding.authoritySourceRef !== recoveryPolicyId
      || binding.authoritySourceVersion !== actorSnapshotDigest
      || binding.authorityPurpose !== 'collective_decision'
      || limits.trigger !== 'zero_eligible_electorate'
      || limits.maxCostMinor !== '0'
      || limits.assetAuthority !== 'none'
      || limits.singleUse !== true
      || !/^[a-f0-9]{64}$/.test(actorSnapshotDigest)
      || !Number.isSafeInteger(minimumApprovalThreshold)
      || minimumApprovalThreshold < 2
      || minimumTimelockSeconds !== 0
      || selector.environment !== 'local_development'
      || !isKnownGovernedActionNetwork(selector.network)
      || authoritySelector.network !== selector.network
      || selector.actionType !== actionType
      || selector.subjectType !== input.subjectType
      || selector.subjectRef !== input.subjectRef
      || !selectorMatches
      || Number.isNaN(effectiveFrom.getTime())
      || Number.isNaN(effectiveUntil.getTime())
      || input.now < effectiveFrom
      || input.now >= effectiveUntil
      || Number.isNaN(authorityEffectiveFrom.getTime())
      || Number.isNaN(authorityEffectiveUntil.getTime())
      || authorityEffectiveFrom < effectiveFrom
      || authorityEffectiveFrom > input.now
      || authorityEffectiveUntil.getTime() !== effectiveUntil.getTime()
      || resolution?.policy.id !== binding.policyId
      || resolution?.policyVersion.id !== binding.policyVersionId
      || resolution?.policyVersion.version !== binding.policyVersion
      || authorityPolicyBinding.sourceType !== 'governance_recovery_policy'
      || authorityPolicyBinding.sourceRef !== recoveryPolicyId
      || authorityPolicyBinding.sourceVersion !== actorSnapshotDigest
      || authorityPolicyBinding.purpose !== 'collective_decision'
      || authoritySelector.actionType !== actionType
      || authoritySelector.subjectType !== input.subjectType
      || authoritySelector.subjectRef !== input.subjectRef
      || authorityLimits.domainBindingId !== binding.id
      || authorityLimits.recoveryPolicyId !== recoveryPolicyId
      || authorityLimits.actorSnapshotDigest !== actorSnapshotDigest
      || authorityLimits.maxCostMinor !== '0'
      || authorityLimits.assetAuthority !== 'none'
      || authorityLimits.singleUse !== true
      || resolvedAuthority.sourceType !== authorityPolicyBinding.sourceType
      || resolvedAuthority.sourceRef !== authorityPolicyBinding.sourceRef
      || resolvedAuthority.sourceVersion !== authorityPolicyBinding.sourceVersion
      || resolvedAuthority.selectorDigest !== authorityPolicyBinding.bindingDigest
      || recomputedAuthority?.capabilityDigest !== resolvedAuthority.capabilityDigest
      || executionAuthority.type !== 'registered_adapter'
      || executionAuthority.ref !== input.actionContract.executionAdapter
    ) throw new GovernanceCaseTemplateError(409, 'governance_case_recovery_authority_required');
    resolveGovernedActionRuntimeContext({
      binding: { authoritySelector: selector as Record<string, unknown> },
      aapbSelectorNetwork: authoritySelector.network,
    });
    return {
      schemaVersion: 1,
      sourceType: 'governance_recovery_policy',
      projectionBindingId: binding.id,
      mandateId: null,
      mandateVersion: null,
      mandateTermsDigest: null,
      recoveryPolicy: {
        id: recoveryPolicyId,
        trigger: 'zero_eligible_electorate',
        actorSnapshotDigest,
        maxCostMinor: '0',
        singleUse: true,
      },
      sourceVersion: actorSnapshotDigest,
      profile: { ...profile },
      authorityPolicyBinding: {
        id: String(authorityPolicyBinding.id),
        bindingDigest: String(authorityPolicyBinding.bindingDigest),
        sourceType: 'governance_recovery_policy',
        sourceRef: recoveryPolicyId,
        sourceVersion: actorSnapshotDigest,
        purpose: 'collective_decision',
        limitsDigest: String(resolvedAuthority.capabilityDigest),
      },
      governanceHome: { type: 'circle', ref: String(input.targetCircleId) },
      committeeHome: { type: 'circle', ref: String(binding.committeeCircleId) },
      subject: { type: 'circle_governance_binding', ref: input.subjectRef! },
      action: {
        type: actionType,
        selector: { actionType: actionSelector, actionPrefix },
        riskFloor: stricterCaseRiskFloor(input.actionContract.riskFloor, String(limits.riskFloor) as any),
      },
      minimumConstraints: {
        riskFloor: String(limits.riskFloor) as GovernedActionDefinition['impact'],
        minimumApprovalThreshold,
        minimumTimelockSeconds,
      },
      purpose: 'collective_decision',
      operatorSelector: { mode: 'not_applicable', reason: 'collective_decision' },
      executionAuthorityRequirement: {
        type: 'registered_adapter',
        adapter: input.actionContract.executionAdapter,
        executionDomain: input.actionContract.executionDomain,
        liveReadback: 'required_before_execution',
        runtimeOwner: 'P06',
      },
      environment: 'local_development',
      network: selector.network,
      policy: {
        id: binding.policyId,
        versionId: binding.policyVersionId,
        version: binding.policyVersion,
        ruleId: binding.ruleId,
      },
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveUntil: effectiveUntil.toISOString(),
    };
  }
  if (binding?.authoritySourceType === 'circle_governance_binding') {
    const authorityEffectiveFrom = new Date(String(authorityPolicyBinding?.effectiveFrom ?? 'invalid'));
    const authorityEffectiveUntil = new Date(String(authorityPolicyBinding?.effectiveUntil ?? 'invalid'));
    const selfHealthAction = actionType === 'circle.governance_binding.authority_health.check';
    const exactSelfGovernedAction = Boolean(
      exactActionRequired
      && input.subjectType
      && input.subjectRef
      && actionSelector === actionType
      && actionPrefix == null
      && selector.subjectType === input.subjectType
      && selector.subjectRef === input.subjectRef
      && authoritySelector.actionType === actionType
      && authoritySelector.actionPrefix == null
      && authoritySelector.subjectType === input.subjectType
      && authoritySelector.subjectRef === input.subjectRef,
    );
    const selfAuthorityWindowValid = selfHealthAction
      ? authorityPolicyBinding?.effectiveUntil === null
      : exactSelfGovernedAction
        && !Number.isNaN(effectiveFrom.getTime())
        && !Number.isNaN(effectiveUntil.getTime())
        && effectiveUntil > effectiveFrom
        && effectiveFrom <= input.now
        && input.now < effectiveUntil
        && binding.authorityEffectiveFrom?.toISOString() === effectiveFrom.toISOString()
        && binding.authorityEffectiveUntil?.toISOString() === effectiveUntil.toISOString()
        && authorityLimits.effectiveFrom === effectiveFrom.toISOString()
        && authorityLimits.effectiveUntil === effectiveUntil.toISOString()
        && !Number.isNaN(authorityEffectiveUntil.getTime())
        && Math.floor(authorityEffectiveUntil.getTime() / 1000)
          === Math.floor(effectiveUntil.getTime() / 1000);
    if (
      (!selfHealthAction && !exactSelfGovernedAction)
      || !input.actionContract
      || !profile
      || !authorityPolicyBinding
      || !Number.isSafeInteger(input.targetCircleId)
      || input.targetCircleId! <= 0
      || (
        selfHealthAction
          ? input.subjectType !== 'circle_governance_binding' || input.subjectRef !== binding.id
          : !exactSelfGovernedAction
      )
      || binding.bindingType !== 'self_governed'
      || binding.status !== 'active'
      || (
        exactSelfGovernedAction
        && (
          binding.targetAuthorizationStatus !== 'accepted'
          || binding.committeeMandateStatus !== 'accepted'
        )
      )
      || binding.targetCircleId !== input.targetCircleId
      || binding.committeeCircleId !== input.targetCircleId
      || binding.authoritySourceRef !== binding.id
      || !String(binding.authoritySourceVersion ?? '').trim()
      || binding.authorityPurpose !== 'collective_decision'
      || resolution?.policy.id !== binding.policyId
      || resolution?.policyVersion.id !== binding.policyVersionId
      || resolution?.policyVersion.version !== binding.policyVersion
      || !profile.bindingId
      || !profile.versionRef
      || !/^[a-f0-9]{64}$/.test(profile.definitionDigest)
      || !String(authorityPolicyBinding.id ?? '').trim()
      || authorityPolicyBinding.sourceType !== 'circle_governance_binding'
      || authorityPolicyBinding.sourceRef !== binding.id
      || authorityPolicyBinding.purpose !== 'collective_decision'
      || !/^[a-f0-9]{64}$/.test(String(authorityPolicyBinding.bindingDigest ?? ''))
      || resolvedAuthority.sourceType !== authorityPolicyBinding.sourceType
      || resolvedAuthority.sourceRef !== authorityPolicyBinding.sourceRef
      || resolvedAuthority.sourceVersion !== authorityPolicyBinding.sourceVersion
      || resolvedAuthority.selectorDigest !== authorityPolicyBinding.bindingDigest
      || !/^[a-f0-9]{64}$/.test(String(resolvedAuthority.capabilityDigest ?? ''))
      || recomputedAuthority?.sourceType !== resolvedAuthority.sourceType
      || recomputedAuthority?.sourceRef !== resolvedAuthority.sourceRef
      || recomputedAuthority?.sourceVersion !== resolvedAuthority.sourceVersion
      || recomputedAuthority?.selectorDigest !== resolvedAuthority.selectorDigest
      || recomputedAuthority?.capabilityDigest !== resolvedAuthority.capabilityDigest
      || authoritySelector.actionType !== actionType
      || (
        exactSelfGovernedAction
        && (
          selector.actionPrefix != null
          || selector.targetCircleId !== input.targetCircleId
          || selector.environment !== 'local_development'
          || !isKnownGovernedActionNetwork(selector.network)
          || authoritySelector.network !== selector.network
        )
      )
      || authoritySelector.targetCircleId !== input.targetCircleId
      || authoritySelector.environment !== 'local_development'
      || !isKnownGovernedActionNetwork(authoritySelector.network)
      || authorityLimits.domainBindingId !== binding.id
      || authorityLimits.policyId !== binding.policyId
      || authorityLimits.policyVersionId !== binding.policyVersionId
      || authorityLimits.policyVersion !== binding.policyVersion
      || authorityLimits.ruleId !== binding.ruleId
      || authorityLimits.committeeCircleId !== binding.committeeCircleId
      || authorityLimits.riskFloor !== (
        exactSelfGovernedAction
          ? expectedAuthorityRiskFloor
          : input.actionContract.riskFloor
      )
      || (
        exactSelfGovernedAction
        && (
          !['low', 'medium', 'high', 'critical'].includes(minimumRiskFloor)
          || !Number.isSafeInteger(minimumApprovalThreshold)
          || minimumApprovalThreshold <= 0
          || minimumApprovalThreshold > 10_000
          || !Number.isSafeInteger(minimumTimelockSeconds)
          || minimumTimelockSeconds < 0
          || minimumTimelockSeconds > 30 * 24 * 60 * 60
          || authorityLimits.minimumApprovalThreshold !== minimumApprovalThreshold
          || authorityLimits.minimumTimelockSeconds !== minimumTimelockSeconds
        )
      )
      || Number.isNaN(authorityEffectiveFrom.getTime())
      || (
        exactSelfGovernedAction
        && Math.floor(authorityEffectiveFrom.getTime() / 1000)
          < Math.floor(effectiveFrom.getTime() / 1000)
      )
      || authorityEffectiveFrom > input.now
      || !selfAuthorityWindowValid
      || executionAuthority.type !== 'registered_adapter'
      || executionAuthority.ref !== input.actionContract.executionAdapter
    ) throw new GovernanceCaseTemplateError(409, 'governance_case_self_authority_required');
    resolveGovernedActionRuntimeContext({
      binding: { authoritySelector },
    });
    return {
      schemaVersion: 1,
      sourceType: 'circle_governance_binding',
      projectionBindingId: binding.id,
      mandateId: null,
      mandateVersion: null,
      mandateTermsDigest: null,
      sourceVersion: exactSelfGovernedAction
        ? String(resolvedAuthority.sourceVersion)
        : String(binding.authoritySourceVersion),
      profile: { ...profile },
      authorityPolicyBinding: {
        id: String(authorityPolicyBinding.id),
        bindingDigest: String(authorityPolicyBinding.bindingDigest),
        sourceType: 'circle_governance_binding',
        sourceRef: String(authorityPolicyBinding.sourceRef),
        sourceVersion: authorityPolicyBinding.sourceVersion == null
          ? null
          : String(authorityPolicyBinding.sourceVersion),
        purpose: 'collective_decision',
        limitsDigest: String(resolvedAuthority.capabilityDigest),
      },
      governanceHome: { type: 'circle', ref: String(input.targetCircleId) },
      committeeHome: { type: 'circle', ref: String(binding.committeeCircleId) },
      subject: {
        type: input.subjectType as
          | 'circle_governance_binding'
          | 'external_provider'
          | 'external_app_circle_binding',
        ref: input.subjectRef!,
      },
      action: {
        type: actionType,
        selector: { actionType, actionPrefix: null },
        riskFloor: input.actionContract.riskFloor,
      },
      minimumConstraints: {
        riskFloor: (exactSelfGovernedAction
          ? minimumRiskFloor
          : input.actionContract.riskFloor) as GovernedActionDefinition['impact'],
        minimumApprovalThreshold: exactSelfGovernedAction ? minimumApprovalThreshold : 1,
        minimumTimelockSeconds: exactSelfGovernedAction ? minimumTimelockSeconds : 0,
      },
      purpose: 'collective_decision',
      operatorSelector: { mode: 'not_applicable', reason: 'collective_decision' },
      executionAuthorityRequirement: {
        type: 'registered_adapter',
        adapter: input.actionContract.executionAdapter,
        executionDomain: input.actionContract.executionDomain,
        liveReadback: 'required_before_execution',
        runtimeOwner: 'P06',
      },
      environment: 'local_development',
      network: authoritySelector.network,
      policy: {
        id: binding.policyId,
        versionId: binding.policyVersionId,
        version: binding.policyVersion,
        ruleId: binding.ruleId,
      },
      effectiveFrom: authorityEffectiveFrom.toISOString(),
      effectiveUntil: exactSelfGovernedAction ? effectiveUntil.toISOString() : null,
      selfBinding: { bindingType: 'self_governed', status: 'active' },
    };
  }
  const mandateSelfGovernance = [
    'circle.governance_binding.accept_mandate',
    'circle.governance_binding.deactivate',
    'circle.governance_binding.policy_version.update',
    'circle.governance_binding.replace',
  ].includes(actionType)
    && input.subjectType === 'circle_governance_binding'
    && input.subjectRef === binding?.id;
  const delegatedCommunicationMember = !exactActionRequired
    && actionType === 'communication.member.mute'
    && input.subjectType === 'communication_room_member'
    && input.subjectRef?.startsWith(`${input.targetCircleId}:`)
    && selector.subjectType === 'circle'
    && selector.subjectRef === String(input.targetCircleId);
  const delegatedOperatorCapability = !exactActionRequired
    && actionType === 'operator.capability.suspend'
    && input.subjectType === 'governed_operator_capability'
    && input.subjectRef?.startsWith(`${input.targetCircleId}:operator-capability:`)
    && selector.subjectType === 'circle'
    && selector.subjectRef === String(input.targetCircleId);
  const exactSubjectMatches = exactActionRequired
    && selector.subjectType === input.subjectType
    && selector.subjectRef === input.subjectRef
    && authoritySelector.subjectType === input.subjectType
    && authoritySelector.subjectRef === input.subjectRef;
  const subjectMatches = exactActionRequired
    ? exactSubjectMatches
    : input.subjectType === 'circle'
      ? input.subjectRef === String(input.targetCircleId)
      : mandateSelfGovernance
        || delegatedCommunicationMember
        || delegatedOperatorCapability;
  if (
    !binding
    || !input.actionContract
    || !profile
    || !authorityPolicyBinding
    || !Number.isSafeInteger(input.targetCircleId)
    || input.targetCircleId! <= 0
    || !subjectMatches
    || binding.targetCircleId !== input.targetCircleId
    || binding.authoritySourceType !== 'governance_mandate'
    || !binding.authoritySourceRef
    || !Number.isSafeInteger(mandateVersion)
    || mandateVersion <= 0
    || !/^[a-f0-9]{64}$/.test(mandateTermsDigest)
    || !isValidGovernanceMandateFeePolicySnapshotSource(mandateFeePolicy)
    || !['low', 'medium', 'high', 'critical'].includes(minimumRiskFloor)
    || !Number.isSafeInteger(minimumApprovalThreshold)
    || minimumApprovalThreshold <= 0
    || minimumApprovalThreshold > 10_000
    || !Number.isSafeInteger(minimumTimelockSeconds)
    || minimumTimelockSeconds < 0
    || minimumTimelockSeconds > 30 * 24 * 60 * 60
    || limits.mandateId !== binding.authoritySourceRef
    || binding.authoritySourceVersion !== governanceMandateAuthoritySourceVersion(
      mandateVersion,
      mandateTermsDigest,
    )
    || binding.authorityPurpose !== 'collective_decision'
    || selector.environment !== 'local_development'
    || !isKnownGovernedActionNetwork(selector.network)
    || (
      exactActionRequired
        ? (
          selector.subjectType !== input.subjectType
          || selector.subjectRef !== input.subjectRef
        )
        : (
          selector.subjectType !== 'circle'
          || selector.subjectRef !== String(input.targetCircleId)
        )
    )
    || (!selectorMatches && !mandateSelfGovernance)
    || limits.targetCircleId !== binding.targetCircleId
    || limits.committeeCircleId !== binding.committeeCircleId
    || Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || effectiveUntil <= effectiveFrom
    || input.now < effectiveFrom
    || input.now >= effectiveUntil
    || binding.authorityEffectiveFrom?.toISOString() !== effectiveFrom.toISOString()
    || binding.authorityEffectiveUntil?.toISOString() !== effectiveUntil.toISOString()
    || resolution?.policy.id !== binding.policyId
    || resolution?.policyVersion.id !== binding.policyVersionId
    || resolution?.policyVersion.version !== binding.policyVersion
    || !profile.bindingId
    || !profile.versionRef
    || !/^[a-f0-9]{64}$/.test(profile.definitionDigest)
    || !String(authorityPolicyBinding.id ?? '').trim()
    || authorityPolicyBinding.sourceType !== 'governance_mandate'
    || authorityPolicyBinding.sourceRef !== binding.authoritySourceRef
    || authorityPolicyBinding.purpose !== 'collective_decision'
    || !/^[a-f0-9]{64}$/.test(String(authorityPolicyBinding.bindingDigest ?? ''))
    || resolvedAuthority.sourceType !== authorityPolicyBinding.sourceType
    || resolvedAuthority.sourceRef !== authorityPolicyBinding.sourceRef
    || resolvedAuthority.sourceVersion !== authorityPolicyBinding.sourceVersion
    || resolvedAuthority.selectorDigest !== authorityPolicyBinding.bindingDigest
    || !/^[a-f0-9]{64}$/.test(String(resolvedAuthority.capabilityDigest ?? ''))
    || recomputedAuthority?.sourceType !== resolvedAuthority.sourceType
    || recomputedAuthority?.sourceRef !== resolvedAuthority.sourceRef
    || recomputedAuthority?.sourceVersion !== resolvedAuthority.sourceVersion
    || recomputedAuthority?.selectorDigest !== resolvedAuthority.selectorDigest
    || recomputedAuthority?.capabilityDigest !== resolvedAuthority.capabilityDigest
    || authoritySelector.actionType !== actionType
    || (
      exactActionRequired
        ? (
          authoritySelector.subjectType !== input.subjectType
          || authoritySelector.subjectRef !== input.subjectRef
        )
        : (
          authoritySelector.subjectType !== 'circle'
          || authoritySelector.subjectRef !== String(input.targetCircleId)
        )
    )
    || authoritySelector.environment !== 'local_development'
    || authoritySelector.network !== selector.network
    || authorityLimits.domainBindingId !== binding.id
    || authorityLimits.policyId !== binding.policyId
    || authorityLimits.policyVersionId !== binding.policyVersionId
    || authorityLimits.policyVersion !== binding.policyVersion
    || authorityLimits.ruleId !== binding.ruleId
    || authorityLimits.committeeCircleId !== binding.committeeCircleId
    || authorityLimits.riskFloor !== expectedAuthorityRiskFloor
    || authorityLimits.minimumApprovalThreshold !== minimumApprovalThreshold
    || authorityLimits.minimumTimelockSeconds !== minimumTimelockSeconds
    || authorityLimits.effectiveFrom !== effectiveFrom.toISOString()
    || authorityLimits.effectiveUntil !== effectiveUntil.toISOString()
    || Number.isNaN(authorityEffectiveFrom.getTime())
    || Number.isNaN(authorityEffectiveUntil.getTime())
    || Math.floor(authorityEffectiveFrom.getTime() / 1000)
      < Math.floor(effectiveFrom.getTime() / 1000)
    || authorityEffectiveFrom > input.now
    || Math.floor(authorityEffectiveUntil.getTime() / 1000)
      !== Math.floor(effectiveUntil.getTime() / 1000)
    || executionAuthority.type !== 'registered_adapter'
    || executionAuthority.ref !== input.actionContract.executionAdapter
  ) {
    throw new GovernanceCaseTemplateError(409, 'governance_case_mandate_authority_required');
  }
  resolveGovernedActionRuntimeContext({
    binding: { authoritySelector: selector as Record<string, unknown> },
    aapbSelectorNetwork: authoritySelector.network,
    mandateNetwork: selector.network,
  });
  return {
    schemaVersion: 1,
    sourceType: 'governance_mandate',
    projectionBindingId: binding.id,
    mandateId: binding.authoritySourceRef,
    mandateVersion,
    mandateTermsDigest,
    mandateCostPolicy: buildGovernanceMandateCostPolicySnapshot({
      mandateId: binding.authoritySourceRef,
      mandateVersion,
      mandateTermsDigest,
      feePolicy: mandateFeePolicy,
    }),
    sourceVersion: binding.authoritySourceVersion,
    profile: { ...profile },
    authorityPolicyBinding: {
      id: String(authorityPolicyBinding.id),
      bindingDigest: String(authorityPolicyBinding.bindingDigest),
      sourceType: 'governance_mandate',
      sourceRef: String(authorityPolicyBinding.sourceRef),
      sourceVersion: authorityPolicyBinding.sourceVersion == null
        ? null
        : String(authorityPolicyBinding.sourceVersion),
      purpose: 'collective_decision',
      limitsDigest: String(resolvedAuthority.capabilityDigest),
    },
    governanceHome: { type: 'circle', ref: String(input.targetCircleId) },
    committeeHome: { type: 'circle', ref: String(binding.committeeCircleId) },
    subject: {
      type: input.subjectType as
        | 'circle'
        | 'circle_governance_binding'
        | 'communication_room_member'
        | 'governed_operator_capability'
        | 'external_provider'
        | 'external_app_circle_binding',
      ref: input.subjectRef!,
    },
    action: {
      type: actionType,
      selector: { actionType: actionSelector, actionPrefix },
      riskFloor: stricterCaseRiskFloor(
        input.actionContract.riskFloor,
        minimumRiskFloor as GovernedActionDefinition['impact'],
      ),
    },
    minimumConstraints: {
      riskFloor: minimumRiskFloor as GovernedActionDefinition['impact'],
      minimumApprovalThreshold,
      minimumTimelockSeconds,
    },
    purpose: 'collective_decision',
    operatorSelector: {
      mode: 'not_applicable',
      reason: 'collective_decision',
    },
    executionAuthorityRequirement: {
      type: 'registered_adapter',
      adapter: input.actionContract.executionAdapter,
      executionDomain: input.actionContract.executionDomain,
      liveReadback: 'required_before_execution',
      runtimeOwner: 'P06',
    },
    environment: 'local_development',
    network: selector.network,
    policy: {
      id: binding.policyId,
      versionId: binding.policyVersionId,
      version: binding.policyVersion,
      ruleId: binding.ruleId,
    },
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveUntil: effectiveUntil.toISOString(),
  };
}

function isValidGovernanceMandateFeePolicySnapshotSource(
  value: Record<string, unknown>,
): boolean {
  return (
    (value.mode === 'no_fee' || value.mode === 'capped_external_quote')
    && (value.economicBearer === 'delegator'
      || value.economicBearer === 'delegate'
      || value.economicBearer === 'shared')
    && (value.maximumAmountMinor === null || typeof value.maximumAmountMinor === 'string')
    && (value.unit === null || typeof value.unit === 'string')
    && value.settlement === 'not_managed_by_mandate'
    && value.payerAuthority === 'separate_from_governance_authority'
  );
}

function buildGovernanceMandateCostPolicySnapshot(input: {
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  feePolicy: Record<string, unknown>;
}): GovernanceMandateCostPolicySnapshot {
  const costClasses: GovernanceMandateCostClass[] = [
    'decision',
    'review',
    'operational',
    'appeal',
    'execution',
  ];
  return {
    schemaVersion: 1,
    authority: 'frozen_governance_mandate_version_fee_policy',
    mandateId: input.mandateId,
    mandateVersion: input.mandateVersion,
    mandateTermsDigest: input.mandateTermsDigest,
    policySource: 'GovernanceMandateVersion.terms.feePolicy',
    costClasses: costClasses.map((costClass) => ({
      costClass,
      mode: input.feePolicy.mode as 'no_fee' | 'capped_external_quote',
      economicBearer: input.feePolicy.economicBearer as 'delegator' | 'delegate' | 'shared',
      maximumAmountMinor: input.feePolicy.maximumAmountMinor === null
        ? null
        : String(input.feePolicy.maximumAmountMinor),
      unit: input.feePolicy.unit === null ? null : String(input.feePolicy.unit),
    })),
    specialBudget: {
      mode: 'not_managed_by_mandate',
      maximumAmountMinor: input.feePolicy.maximumAmountMinor === null
        ? null
        : String(input.feePolicy.maximumAmountMinor),
      unit: input.feePolicy.unit === null ? null : String(input.feePolicy.unit),
    },
    payerAuthority: 'separate_from_governance_authority',
    payerAuthoritySeparatedFromDecisionAuthority: true,
    silentTransferToVoterOperatorExecutorAllowed: false,
    executionCostBearer: 'same_as_mandate_fee_policy',
  };
}

function stricterCaseRiskFloor(
  actionRisk: GovernedActionDefinition['impact'],
  mandateMinimum: GovernedActionDefinition['impact'],
): GovernedActionDefinition['impact'] {
  const ranks: Record<GovernedActionDefinition['impact'], number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return ranks[mandateMinimum] >= ranks[actionRisk] ? mandateMinimum : actionRisk;
}

function mechanism(
  kind: GovernanceMechanismKind,
  availability: 'available' | 'unavailable',
  resource: string,
  formula: string,
  sybilRisk: string,
  resultType: string,
  provider: string,
  reasonCodes: string[],
  identitySensitive = false,
): GovernanceMechanismCatalogItem {
  return {
    kind,
    availability,
    resource,
    formula,
    sybilRisk,
    resultType,
    provider,
    boundaries: { ...COMMON_BOUNDARIES },
    identityEnforcement: identitySensitive ? {
      claimClass: 'not_registered',
      acquisition: 'not_registered',
      appeal: 'not_registered',
      providerEnforcement: 'not_registered',
      feePolicy: 'not_registered',
    } : null,
    reasonCodes,
  };
}

function providerReadiness(
  provider: GovernanceProviderReadinessItem['provider'],
  ready: boolean,
  riskMaturity: GovernanceProviderReadinessItem['riskMaturity'] = ready ? 'stable' : 'experimental',
): GovernanceProviderReadinessItem {
  const readinessState: GovernanceTemplateReadinessState = ready ? 'ready' : 'unavailable';
  return {
    provider,
    availability: ready ? 'available' : 'unavailable',
    readinessState,
    riskMaturity,
    registry: {
      sourceRef: 'current_governance_case_template_catalog',
      lifecycle: ready ? 'active' : 'candidate',
      capabilityRole: provider === 'alcheme_internal' ? 'native_governance' : 'provider_governance',
      integrationKind: 'protocol_direct',
      network: ready ? 'alcheme:off_chain_current_scope' : 'provider-specific activation not ready in the current Case template',
      auth: ready ? 'current GovernanceRequest/Policy/Signal authority' : 'provider authority must be frozen before activation',
      feeModel: ready ? 'none for native no-provider decision path' : 'provider fee model not approved for current template activation',
      availabilityBoundary: ready
        ? 'native governance path is available for current policy Case decisions'
        : 'candidate provider is visible but cannot open stage or execute until readiness, enforcement, finality and readback are proven',
      privacyBoundary: ready
        ? 'native private evidence remains behind existing Case authorization'
        : 'provider candidate cannot receive private evidence before purpose, minimum payload and deletion/readback policy are approved',
      requiredReadback: ready ? [] : ['program_version', 'authority', 'enforcement', 'finality', 'readback'],
      forbiddenMappings: ready ? [] : ['candidate_provider_cannot_authorize_or_execute'],
      contractPortability: {
        evmDependency: 'none',
        requiredProviderKeys: ready
          ? ['governanceHomeRef', 'policyVersionRef', 'caseId', 'requestId']
          : ['providerProfileRef', 'programOrServiceRef', 'authorityRef', 'readbackRef'],
        forbiddenAssumptions: [
          'no_evm_address_requirement',
          'no_eip_712_requirement',
          'no_governor_safe_requirement',
          'no_adapter_or_reference_fixture_without_future_gate',
        ],
        futureGate: 'required_for_new_adapter_or_reference_fixture',
      },
      authoritySeparation: {
        institutionalDecisionAuthority: ready ? 'native_governance_policy' : 'provider_external',
        providerStageBinding: ready
          ? 'not_required'
          : 'required_only_when_committee_policy_selects_external_provider',
        bindingCondition: ready
          ? 'current native policy Case does not create a technical provider stage binding'
          : 'Committee Circle remains the institutional decision authority; external provider stage binding is created only when that Committee-approved policy explicitly selects the provider',
      },
      specializedReadiness: specializedProviderReadiness(provider, ready),
    },
    stageGate: {
      openStage: readinessState === 'ready' ? 'allowed' : 'blocked',
      execute: readinessState === 'ready' ? 'allowed' : 'blocked',
      riskConfirmation: riskMaturity === 'experimental' ? 'required' : 'not_required',
      riskDoesNotOverrideReadiness: true,
    },
    checks: {
      program: ready,
      version: ready,
      ui: ready,
      enforcement: ready,
      finality: ready,
      readback: ready,
    },
    reasonCodes: ready ? [] : ['provider_readiness_required_P06'],
  };
}

function candidateProviderReadiness(
  provider: GovernanceProviderReadinessItem['provider'],
  input: Omit<GovernanceProviderReadinessItem['registry'], 'sourceRef' | 'lifecycle' | 'contractPortability' | 'specializedReadiness'>
    & Pick<GovernanceProviderReadinessItem, 'readinessState'>
    & { reasonCodes: string[]; requiredProviderKeys: string[] },
): GovernanceProviderReadinessItem {
  return {
    provider,
    availability: 'unavailable',
    readinessState: input.readinessState,
    riskMaturity: 'experimental',
    registry: {
      sourceRef: 'current_governance_case_template_catalog',
      lifecycle: 'candidate',
      capabilityRole: input.capabilityRole,
      integrationKind: input.integrationKind,
      network: input.network,
      auth: input.auth,
      feeModel: input.feeModel,
      availabilityBoundary: input.availabilityBoundary,
      privacyBoundary: input.privacyBoundary,
      requiredReadback: [...input.requiredReadback],
      forbiddenMappings: [...input.forbiddenMappings],
      contractPortability: {
        evmDependency: 'none',
        requiredProviderKeys: [...input.requiredProviderKeys],
        forbiddenAssumptions: [
          'no_evm_address_requirement',
          'no_chain_id_evm_assumption',
          'no_eip_712_requirement',
          'no_governor_safe_requirement',
          'no_adapter_or_reference_fixture_without_future_gate',
        ],
        futureGate: 'required_for_new_adapter_or_reference_fixture',
      },
      authoritySeparation: { ...input.authoritySeparation },
      specializedReadiness: specializedProviderReadiness(provider, false),
    },
    stageGate: {
      openStage: 'blocked',
      execute: 'blocked',
      riskConfirmation: 'required',
      riskDoesNotOverrideReadiness: true,
    },
    checks: {
      program: false,
      version: false,
      ui: false,
      enforcement: false,
      finality: false,
      readback: false,
    },
    reasonCodes: [...input.reasonCodes],
  };
}

function snsDisplayProviderReadiness(): GovernanceProviderReadinessItem {
  const readiness = resolveSnsProviderTrustReadiness();
  return {
    provider: 'solana_name_service',
    availability: 'available',
    readinessState: 'ready',
    riskMaturity: 'stable',
    registry: {
      sourceRef: 'current_governance_case_template_catalog',
      lifecycle: 'active',
      capabilityRole: 'name_resolution_display_input',
      integrationKind: 'protocol_direct_or_sdk_proxy',
      network: `${readiness.chainId}; program ${readiness.programId}; SDK ${readiness.sdkPackageRef}`,
      auth: 'domain/record ownership and RPC read only; never governance authority',
      feeModel: 'RPC/registration/record/provider cost; display reads may be sponsored only after fee approval',
      availabilityBoundary: 'SNS display resolve is ready for primary-domain secondary labels; registration/renewal/primary update remain external optional actions; stage/execute stay blocked',
      privacyBoundary: 'resolved names are display/input hints; Circle surfaces default to Circle Alias; stale or private records must not leak hidden identity evidence',
      requiredReadback: [
        'cluster_program_sdk',
        'primary_domain_read',
        'forward_resolve',
        'record_staleness_validation',
        'observed_slot',
        'cache_ttl',
        'privacy_availability',
      ],
      forbiddenMappings: [
        'sns_display_is_not_eligibility',
        'sns_display_is_not_authority',
        'stale_record_cannot_authorize_execution',
      ],
      contractPortability: {
        evmDependency: 'none',
        requiredProviderKeys: ['cluster', 'programId', 'sdkPackageRef', 'rpcEndpointRef'],
        forbiddenAssumptions: [
          'no_evm_address_requirement',
          'no_chain_id_evm_assumption',
          'no_eip_712_requirement',
          'no_governor_safe_requirement',
          'no_adapter_or_reference_fixture_without_future_gate',
        ],
        futureGate: 'required_for_new_adapter_or_reference_fixture',
      },
      authoritySeparation: candidateProviderAuthoritySeparation('not_required'),
      specializedReadiness: specializedProviderReadiness('solana_name_service', true),
    },
    stageGate: {
      openStage: 'blocked',
      execute: 'blocked',
      riskConfirmation: 'required',
      riskDoesNotOverrideReadiness: true,
    },
    checks: {
      program: true,
      version: true,
      ui: true,
      enforcement: true,
      finality: false,
      readback: true,
    },
    reasonCodes: [
      'provider_display_input_only_P06',
      'sns_stage_execute_remain_blocked',
      `sns_profile_digest:${readiness.profileDigest}`,
    ],
  };
}

function koraFeeAbstractionProviderReadiness(): GovernanceProviderReadinessItem {
  const readiness = resolveKoraProviderTrustReadiness();
  return {
    provider: 'kora',
    availability: 'available',
    readinessState: 'ready',
    riskMaturity: 'experimental',
    registry: {
      sourceRef: 'current_governance_case_template_catalog',
      lifecycle: 'active',
      capabilityRole: 'fee_abstraction',
      integrationKind: 'managed_service_or_self_hosted',
      network: `${readiness.chainId}; SDK ${readiness.sdkPackageRef}; live operator ${readiness.liveOperatorBinding}`,
      auth: 'operator signer custody plus exact allowlist for program, instruction and token; signer never becomes decision or execution authority',
      feeModel: 'free/fixed/margin plus network/rent/account creation/payment processing with max fee/outflow and quota caps',
      availabilityBoundary: 'FeeAbstractionPlan contract is ready on CostPreflight quoteContext; live fee transactions remain forbidden until an approved operator/node is bound; stage/execute stay blocked',
      privacyBoundary: 'fee abstraction may see transaction/payment metadata only for the approved purpose and retention window',
      requiredReadback: [
        'node_sdk_version',
        'network_auth_signer_custody',
        'allowed_program_instruction_token',
        'price_model_max_fee_outflow',
        'rate_quota',
        'simulation',
        'receipt',
        'sla_exit',
      ],
      forbiddenMappings: [
        'kora_is_not_decision_authority',
        'kora_is_not_execution_authority',
        'fee_sponsor_signer_cannot_mutate_governed_action',
      ],
      contractPortability: {
        evmDependency: 'none',
        requiredProviderKeys: ['nodeRef', 'sdkVersionRef', 'operatorSignerCustodyRef', 'allowlistRef', 'receiptRef'],
        forbiddenAssumptions: [
          'no_evm_address_requirement',
          'no_chain_id_evm_assumption',
          'no_eip_712_requirement',
          'no_governor_safe_requirement',
          'no_adapter_or_reference_fixture_without_future_gate',
        ],
        futureGate: 'required_for_new_adapter_or_reference_fixture',
      },
      authoritySeparation: candidateProviderAuthoritySeparation('required_only_when_committee_policy_selects_external_provider'),
      specializedReadiness: specializedProviderReadiness('kora', true),
    },
    stageGate: {
      openStage: 'blocked',
      execute: 'blocked',
      riskConfirmation: 'required',
      riskDoesNotOverrideReadiness: true,
    },
    checks: {
      program: false,
      version: true,
      ui: true,
      enforcement: true,
      finality: false,
      readback: true,
    },
    reasonCodes: [
      'provider_fee_abstraction_not_authority_P06',
      'kora_live_fee_tx_forbidden_until_operator_approved',
      `kora_profile_digest:${readiness.profileDigest}`,
    ],
  };
}

function sasAttestationProviderReadiness(): GovernanceProviderReadinessItem {
  const readiness = resolveSasProviderTrustReadiness();
  return {
    provider: 'solana_attestation_service',
    availability: 'available',
    readinessState: 'ready',
    riskMaturity: 'experimental',
    registry: {
      sourceRef: 'current_governance_case_template_catalog',
      lifecycle: 'active',
      capabilityRole: 'attestation_transport',
      integrationKind: 'protocol_direct',
      network: `${readiness.chainId}; program ${readiness.programId}; live attestation ${readiness.liveAttestationBinding}`,
      auth: 'Credential authority, Schema authority and authorized signer must be explicit; payer remains separate',
      feeModel: 'transaction/rent/issuance/provider/RPC cost must be approved before activation',
      availabilityBoundary: 'SybilEvidencePolicy and SAS transport contracts are ready; live attestation issuer binding remains unavailable; stage/execute stay blocked; Civic Pass legacy stays deprecated/unavailable',
      privacyBoundary: 'attestation refs may be used only for declared purpose/consent; raw sensitive evidence stays out of public Case projections',
      requiredReadback: [
        'cluster_program_deployment',
        'credential_schema_authorized_signer',
        'attestation_loader',
        'subject_binding_resolver',
        'issued_at_resolver',
        'invalidation_strategy',
        'privacy_fee_sla_availability',
      ],
      forbiddenMappings: [
        'attestation_transport_is_not_sybil_detector',
        'no_unified_revocation_endpoint_assumption',
        'no_governance_eligibility_without_explicit_claim_policy',
      ],
      contractPortability: {
        evmDependency: 'none',
        requiredProviderKeys: ['cluster', 'programId', 'credentialRef', 'schemaRef', 'authorizedSignerRef'],
        forbiddenAssumptions: [
          'no_evm_address_requirement',
          'no_chain_id_evm_assumption',
          'no_eip_712_requirement',
          'no_governor_safe_requirement',
          'no_adapter_or_reference_fixture_without_future_gate',
        ],
        futureGate: 'required_for_new_adapter_or_reference_fixture',
      },
      authoritySeparation: candidateProviderAuthoritySeparation('required_only_when_committee_policy_selects_external_provider'),
      specializedReadiness: specializedProviderReadiness('solana_attestation_service', true),
    },
    stageGate: {
      openStage: 'blocked',
      execute: 'blocked',
      riskConfirmation: 'required',
      riskDoesNotOverrideReadiness: true,
    },
    checks: {
      program: true,
      version: true,
      ui: true,
      enforcement: true,
      finality: false,
      readback: true,
    },
    reasonCodes: [
      'attestation_transport_is_not_sybil_detector',
      'sas_live_attestation_unavailable',
      `sas_profile_digest:${readiness.profileDigest}`,
    ],
  };
}

function candidateProviderAuthoritySeparation(
  providerStageBinding: GovernanceProviderReadinessItem['registry']['authoritySeparation']['providerStageBinding'],
): GovernanceProviderReadinessItem['registry']['authoritySeparation'] {
  return {
    institutionalDecisionAuthority: 'committee_circle',
    providerStageBinding,
    bindingCondition: providerStageBinding === 'not_required'
      ? 'Provider is advisory or display/input-only; Committee Circle decision authority does not create a technical provider stage binding'
      : 'Committee Circle remains the institutional decision authority; a separate provider stage binding is required only when the Committee-approved policy internally selects this external provider',
  };
}

function specializedProviderReadiness(
  provider: GovernanceProviderReadinessItem['provider'],
  ready: boolean,
): GovernanceProviderReadinessItem['registry']['specializedReadiness'] {
  const isRealmsPlugin = provider === 'realms_plugin';
  const isMetaDao = provider === 'metadao';
  const isNative = provider === 'alcheme_internal' && ready;
  return {
    votingPowerPlugin: isRealmsPlugin ? {
      registrarRef: 'required_before_activation',
      pluginProgramRef: 'required_before_activation',
      voterWeightRecord: 'required_before_activation',
      calculatedWeight: 'required_before_activation',
      updatedAt: 'required_before_activation',
      availability: 'blocked_until_verified_vsr_vwr_nft_or_existing_plugin',
      offChainContributionScore: 'requires_new_oracle_attestation_and_on_chain_plugin',
      customPluginAvailabilityClaim: 'forbidden_without_verified_program',
    } : null,
    conditionalMarket: isMetaDao ? {
      provider: 'metadao',
      twap: 'required_before_use',
      liquidity: 'required_before_use',
      finalization: 'required_before_use',
      feeDisclosure: 'required_before_use',
      terminalEvidence: 'provider_native_market_outcome_required',
      alchemeTallyMode: 'forbidden',
    } : null,
    enforcementGateway: {
      nativeSnapshotGate: isNative ? 'alcheme_snapshot_gate' : 'not_applicable',
      externalProviderConsumption: isNative
        ? 'not_applicable'
        : 'verified_on_chain_plugin_or_gateway_required',
      missingGatewayDisposition: isNative ? 'not_applicable' : 'advisory_only',
      requiredPolicyMapping: isNative ? 'native_exact' : 'weaker_or_not_representable_blocks_activation',
    },
  };
}

function copyMechanism(value: GovernanceMechanismCatalogItem): GovernanceMechanismCatalogItem {
  return {
    ...value,
    boundaries: { ...value.boundaries },
    identityEnforcement: value.identityEnforcement ? { ...value.identityEnforcement } : null,
    reasonCodes: [...value.reasonCodes],
  };
}

function copyProviderReadiness(value: GovernanceProviderReadinessItem): GovernanceProviderReadinessItem {
  return {
    ...value,
    registry: {
      ...value.registry,
      requiredReadback: [...value.registry.requiredReadback],
      forbiddenMappings: [...value.registry.forbiddenMappings],
      contractPortability: {
        ...value.registry.contractPortability,
        requiredProviderKeys: [...value.registry.contractPortability.requiredProviderKeys],
        forbiddenAssumptions: [...value.registry.contractPortability.forbiddenAssumptions],
      },
      authoritySeparation: { ...value.registry.authoritySeparation },
      specializedReadiness: {
        votingPowerPlugin: value.registry.specializedReadiness.votingPowerPlugin
          ? { ...value.registry.specializedReadiness.votingPowerPlugin }
          : null,
        conditionalMarket: value.registry.specializedReadiness.conditionalMarket
          ? { ...value.registry.specializedReadiness.conditionalMarket }
          : null,
        enforcementGateway: { ...value.registry.specializedReadiness.enforcementGateway },
      },
    },
    stageGate: { ...value.stageGate },
    checks: { ...value.checks },
    reasonCodes: [...value.reasonCodes],
  };
}

function copyParticipationPolicy(
  value: GovernanceCaseParticipationPolicy,
): GovernanceCaseParticipationPolicy {
  return {
    admission: { ...value.admission },
    proposalCreation: {
      ...value.proposalCreation,
      eligibleRoles: [...value.proposalCreation.eligibleRoles],
    },
    voterEligibility: { ...value.voterEligibility },
    votingPower: { ...value.votingPower },
    contribution: { ...value.contribution },
    correction: { ...value.correction },
  };
}
