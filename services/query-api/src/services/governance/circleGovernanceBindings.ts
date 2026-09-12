import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { hashCanonicalGovernanceValue } from "./canonicalCodec";
import {
  isKnownGovernedActionNetwork,
  resolveDeploymentAllowedNetworks,
} from "./governedActionRuntimeContext";
import type { GovernanceSignalChainId } from "./signalEnvelopeV2";
import {
  createPrismaGovernanceRequestStore,
  openGovernanceRequest,
} from "./policyEngine";
import {
  createGovernedActionRegistry,
  type GovernedActionDefinition,
  type GovernedActionImpact,
} from './actionRegistry';
import { GovernedActionGateway } from './governedActionGateway';
import {
  governanceMandateAuthoritySourceVersion,
  terminateGovernanceMandateEffectsInTransaction,
} from './governanceMandateEffects';
import {
  hasGovernanceCommitteeOperator,
  listCommitteeEligibleActors,
} from "./circleCommitteeActors";
import {
  committeeReceiveWindowAcceptsActionScope,
  consumeCircleGovernanceCommitteeReceiveWindow,
  DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE,
  resolveCircleGovernanceCommitteeProfile,
  type CircleGovernanceCommitteeElectorateTemplate,
} from "./circleCommitteeProfiles";
import type { GovernanceContinuityIncidentResolution } from './governanceContinuityIncident';
import {
  materializeExactActionAuthorityBinding,
  requiresExactActionAuthorityMaterialization,
  retireExactActionAuthorityBindingsForDomainBinding,
} from './exactActionAuthorityMaterialization';

export {
  hasGovernanceCommitteeOperator,
  isGovernanceCommitteeOperator,
  listCommitteeEligibleActors,
} from "./circleCommitteeActors";

export type CircleGovernanceBindingType =
  | "local_auxiliary"
  | "shared_committee"
  | "self_governed";

export interface CircleGovernanceBindingRecord {
  id: string;
  bindingType: CircleGovernanceBindingType;
  targetCircleId: number;
  actionType?: string | null;
  actionPrefix?: string | null;
  committeeCircleId: number;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  executionMode?: string | null;
  status: string;
  activatedAt?: Date | null;
  supersededAt?: Date | null;
  createdByPubkey?: string | null;
  sourceRequestId?: string | null;
  sourceDecisionDigest?: string | null;
  sourceExecutionReceiptId?: string | null;
  targetAuthorizationStatus: string;
  committeeMandateStatus: string;
  committeeMandateRequestId?: string | null;
  mandateId?: string | null;
  mandate?: GovernanceMandateRecord | null;
  authorityCanonicalState?: string | null;
  shadowComparedAt?: Date | null;
  mandateCanonicalAt?: Date | null;
  authorityRetiredAt?: Date | null;
  authorityContinuityState?: string | null;
  authorityContinuityVersion?: number | null;
  authorityContinuityEvidence?: unknown;
  authorityContinuityEvidenceDigest?: string | null;
  authorityContinuityStartedAt?: Date | null;
  authorityContinuityTerminalAt?: Date | null;
  authorityHealthStatus?: string | null;
  authorityHealthVersion?: number | null;
  authorityHealthEvidence?: unknown;
  authorityHealthEvidenceDigest?: string | null;
  authorityHealthCheckedAt?: Date | null;
  authorityHealthStaleAt?: Date | null;
  authoritySourceType?: string;
  authoritySourceRef?: string;
  authoritySourceVersion?: string | null;
  authorityPurpose?: string;
  authoritySelector?: Record<string, unknown>;
  authorityLimits?: Record<string, unknown>;
  authorityEffectiveFrom?: Date;
  authorityEffectiveUntil?: Date | null;
  metadata?: unknown;
}

export interface GovernanceMandateTerms {
  schemaVersion: 1;
  delegatorGovernanceHome: { type: string; ref: string };
  delegateAuthority: { type: string; ref: string };
  purposeBindings: GovernanceMandatePurposeBinding[];
  environment: "local_development";
  network: GovernanceSignalChainId;
  subject: { type: string; ref: string };
  actionSelector: { actionType: string | null; actionPrefix: string | null };
  minimumConstraints: GovernanceMandateMinimumConstraints;
  feePolicy: GovernanceMandateFeePolicy;
  effectPolicy: GovernanceMandateEffectPolicy | null;
  crossInstitutionDisclosureImpact: GovernanceCrossInstitutionDisclosureImpact | null;
  effectiveFrom: string;
  effectiveUntil: string;
}

export type GovernanceDisclosureDataCategory =
  | "redacted_allegation"
  | "subject_reference"
  | "evidence_digest"
  | "operation_status";

export type GovernanceDisclosurePurpose =
  | "collective_review"
  | "operational_execution"
  | "appeal_review";

export interface GovernanceCrossInstitutionDisclosureImpact {
  schemaVersion: 1;
  homeVisibility: "secret";
  dataCategories: GovernanceDisclosureDataCategory[];
  recipientAuthority: { type: "circle_governance_committee"; ref: string };
  recipientRoles: Array<"Owner" | "Admin" | "Moderator" | "Member">;
  recipientCount: number;
  recipientRegions: string[];
  purposes: GovernanceDisclosurePurpose[];
  retention: { maximumDays: number; startsAt: "each_disclosure" };
  secondaryUse: "prohibited";
  revocation: "stop_future_disclosure_preserve_authorized_history";
  memberNotice: "before_first_disclosure_and_on_terms_change";
}

export interface GovernanceCrossInstitutionDisclosureDeclaration {
  dataCategories: GovernanceDisclosureDataCategory[];
  recipientRegions: string[];
  retentionDays: number;
}

export interface GovernanceMandateFeePolicy {
  mode: "no_fee" | "capped_external_quote";
  economicBearer: "delegator" | "delegate" | "shared";
  maximumAmountMinor: string | null;
  unit: string | null;
  settlement: "not_managed_by_mandate";
  payerAuthority: "separate_from_governance_authority";
}

export interface GovernanceMandateEffectPolicy {
  naturalExpiry: "expire_at_mandate_end";
  revoke: "revoke_immediately";
  transfer: "supersede_immediately";
  appealSurvival: "survives_until_resolved";
  fallbackAuthority: { type: string; ref: string };
}

export type GovernanceMandatePurpose =
  | "collective_decision"
  | "operational_execution";

export interface GovernanceMandatePurposeBinding {
  purpose: GovernanceMandatePurpose;
  actionSelector: { actionType: string | null; actionPrefix: string | null };
  operatorPolicy: GovernanceMandateOperatorPolicy | null;
}

export interface GovernanceMandateOperatorPolicy {
  selector: {
    mode: "institution_roles";
    roles: Array<"Owner" | "Admin" | "Moderator">;
    frozenActors: Array<{ pubkey: string; role: "Owner" | "Admin" | "Moderator" }>;
    actorSetDigest: string;
    maximumActors: number;
  };
  limits: GovernanceMandateOperatorPolicyConstraints;
  reauthorization: {
    mode: "exact_actor_set";
    onMembershipOrRoleDrift: "suspend_and_reauthorize";
    newMembersInheritCapability: false;
  };
  executionAuthorityRequirement: {
    type: "target_adapter";
    adapter: "communication";
    liveReadback: "required_each_invocation";
  };
  termination: {
    naturalExpiry: "stop_new_invocations";
    revoke: "suspend_immediately";
    transfer: "reauthorize_before_resume";
    appealSurvival: "survives_until_resolved";
    fallbackAuthority: "target_governance";
  };
}

export interface GovernanceMandateOperatorPolicyConstraints {
  roles: Array<"Owner" | "Admin" | "Moderator">;
  maximumActors: number;
  maximumDurationSeconds: number;
  frequency: {
    windowSeconds: number;
    maximumInvocations: number;
  };
  appeal: {
    maximumWindowSeconds: number;
  };
  targetScope: "target_circle_exact_subject";
}

export const DEFAULT_GOVERNANCE_MANDATE_OPERATOR_POLICY_CONSTRAINTS:
GovernanceMandateOperatorPolicyConstraints = {
  roles: ["Owner", "Admin", "Moderator"],
  maximumActors: 50,
  maximumDurationSeconds: 24 * 60 * 60,
  frequency: { windowSeconds: 5 * 60, maximumInvocations: 10 },
  appeal: { maximumWindowSeconds: 72 * 60 * 60 },
  targetScope: "target_circle_exact_subject",
};

export interface GovernanceMandateMinimumConstraints {
  riskFloor: GovernedActionImpact;
  minimumApprovalThreshold: number;
  minimumTimelockSeconds: number;
}

export interface GovernanceMandateVersionRecord {
  id: string;
  mandateId: string;
  version: number;
  terms: GovernanceMandateTerms;
  termsDigest: string;
  effectiveFrom: Date;
  effectiveUntil: Date;
  purposeBindings?: GovernanceMandatePurposeBinding[];
  environment?: string;
  network?: string;
  subjectType?: string;
  subjectRef?: string;
  actionType?: string | null;
  actionPrefix?: string | null;
  targetAcceptedAt?: Date | null;
  targetAcceptedByPubkey?: string | null;
  targetAcceptedTermsDigest?: string | null;
  committeeAcceptedAt?: Date | null;
  committeeAcceptedByPubkey?: string | null;
  committeeAcceptedTermsDigest?: string | null;
  sourceRequestId?: string | null;
  sourceDecisionDigest?: string | null;
}

export interface GovernanceMandateRecord {
  id: string;
  delegatorGovernanceHomeType: string;
  delegatorGovernanceHomeRef: string;
  delegateAuthorityType: string;
  delegateAuthorityRef: string;
  bindingType: string;
  status: string;
  currentVersion: number;
  currentTermsDigest: string;
  targetAuthorizationStatus: string;
  committeeAcceptanceStatus: string;
  acceptanceExpiresAt: Date;
  activatedAt?: Date | null;
  expiredAt?: Date | null;
  versions?: GovernanceMandateVersionRecord[];
}

export interface CircleGovernanceCommitteeCircle {
  id: number;
  kind?: string | null;
  mode?: string | null;
  circleType?: string | null;
  lifecycleStatus?: string | null;
  parentCircleId?: number | null;
}

export interface CircleGovernancePolicyRecord {
  id: string;
  scopeType: string;
  scopeRef: string;
  status: string;
}

export interface CircleGovernancePolicyVersionRecord {
  id: string;
  policyId: string;
  version: number;
  status: string;
  rules?: unknown;
  configDigest: string;
}

export interface CircleGovernanceBindingResolution {
  binding: CircleGovernanceBindingRecord;
  committeeCircle: CircleGovernanceCommitteeCircle;
  policy: CircleGovernancePolicyRecord;
  policyVersion: CircleGovernancePolicyVersionRecord;
}

export interface FrozenGovernanceCaseAuthorityReference {
  sourceType?: 'governance_mandate' | 'circle_governance_binding';
  openedAt: Date;
  projectionBindingId: string;
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  subjectType?: string;
  subjectRef?: string;
  policy: {
    id: string;
    versionId: string;
    version: number;
    ruleId: string;
  };
  sourceVersion?: string;
  authorityPolicyBinding?: {
    id: string;
    bindingDigest: string;
    sourceRef: string;
    sourceVersion: string | null;
    purpose: 'collective_decision';
  };
}

export interface CircleGovernanceBindingPrisma {
  circleGovernanceBinding: {
    findMany(input: unknown): Promise<unknown[]>;
  };
  governanceMandate?: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  circleGovernanceCommitteeProfile?: {
    findUnique(input: unknown): Promise<unknown | null>;
    update(input: unknown): Promise<unknown>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  circle: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  governancePolicy: {
    findFirst(input: unknown): Promise<unknown | null>;
  };
  governancePolicyVersion: {
    findFirst(input: unknown): Promise<unknown | null>;
  };
  governanceRecoveryPolicy?: {
    findFirst(input: unknown): Promise<any | null>;
  };
  actionAuthorityPolicyBinding?: {
    findFirst(input: unknown): Promise<any | null>;
  };
}

export interface CircleGovernanceBindingWritePrisma
  extends CircleGovernanceBindingPrisma {
  $transaction<T>(
    operation: (tx: CircleGovernanceBindingWriteTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export interface CircleGovernanceBindingWriteTx {
  governancePolicy: {
    create(input: unknown): Promise<unknown>;
  };
  governancePolicyVersion: {
    create(input: unknown): Promise<unknown>;
  };
  circleGovernanceBinding: {
    findMany(input: unknown): Promise<unknown[]>;
    create(input: unknown): Promise<unknown>;
    update(input: unknown): Promise<unknown>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  governanceMandate: {
    create(input: unknown): Promise<unknown>;
    findUnique(input: unknown): Promise<unknown | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  governanceMandateVersion: {
    create(input: unknown): Promise<unknown>;
    findUnique(input: unknown): Promise<unknown | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  circleGovernanceCommitteeProfile: {
    findUnique(input: unknown): Promise<unknown | null>;
    update(input: unknown): Promise<unknown>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
}

export interface CircleGovernanceBindingSupersedeInput {
  bindingId: string;
  targetCircleId: number;
  actionType: string | null;
  actionPrefix: string | null;
  policyVersionId: string;
  policyVersion: number;
  updatedAt: Date;
  mandateId: string | null;
  sourceRequestId: string;
  sourceDecisionDigest: string;
}

export function buildCommitteePolicyRules(
  actionScope: string,
  electorateTemplate: CircleGovernanceCommitteeElectorateTemplate = DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE,
) {
  return {
    rules: [
      {
        id: `committee:${actionScope}`,
        strategy: "committee.member_threshold",
        electorate: { source: electorateTemplate.source },
        weight: { ...electorateTemplate.weight },
        threshold: { ...electorateTemplate.threshold },
        ballotDisclosure: { ...electorateTemplate.ballotDisclosure },
        quadraticVoiceCredits: { ...electorateTemplate.quadraticVoiceCredits },
        voteReplacement: {
          mode: "not_allowed",
          deadline: "request_expires_at",
        },
      },
    ],
  };
}

const BOOTSTRAP_SELF_GOVERNED_POLICY_DOMAIN =
  'alcheme.governance.bootstrap-self-governed-policy';

export function createBootstrapSelfGovernedPolicyContract() {
  const actionPrefix = 'circle';
  const rules = buildCommitteePolicyRules(actionPrefix);
  const facts = {
    schemaVersion: 1,
    bindingType: 'self_governed',
    actionSelector: { actionType: null, actionPrefix },
    committee: 'target_circle',
    electorate: DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE,
    voteReplacement: { mode: 'not_allowed', deadline: 'request_expires_at' },
    activation: 'signed_bootstrap_bundle_after_authoritative_readback',
    ownerOperatorFallback: 'none',
  } as const;
  return Object.freeze({
    actionPrefix,
    rules,
    reference: Object.freeze({
      ref: 'governance-policy-template:circle:self-governed',
      version: 'current',
      digest: hashCanonicalGovernanceValue(
        BOOTSTRAP_SELF_GOVERNED_POLICY_DOMAIN,
        facts,
      ),
    }),
  });
}

export function bootstrapSelfGovernedCircleBindingId(circleId: number): string {
  if (!Number.isSafeInteger(circleId) || circleId < 1) {
    throw new Error('governance_bootstrap_circle_id_invalid');
  }
  return `circle-governance-self:${circleId}:circle`;
}

export async function createBootstrapSelfGovernedCircleBindingInTransaction(
  tx: any,
  input: {
    circleId: number;
    actorPubkey: string;
    ceremonyId: string;
    configurationBundleId: string;
    configurationBundleDigest: string;
    initialAuthorityPolicy: {
      ref: string;
      version: string;
      digest: string;
    };
    activatedAt: Date;
    sourceRequestId?: string | null;
  },
): Promise<CircleGovernanceBindingRecord> {
  const contract = createBootstrapSelfGovernedPolicyContract();
  if (
    input.initialAuthorityPolicy.ref !== contract.reference.ref
    || input.initialAuthorityPolicy.version !== contract.reference.version
    || input.initialAuthorityPolicy.digest !== contract.reference.digest
  ) {
    throw new Error('governance_bootstrap_initial_authority_policy_mismatch');
  }
  const circle = await tx.circle.findUnique({
    where: { id: input.circleId },
    select: {
      id: true,
      kind: true,
      mode: true,
      circleType: true,
      lifecycleStatus: true,
      parentCircleId: true,
    },
  });
  if (!circle) throw new Error('governance_bootstrap_circle_not_found');
  assertOrdinaryCircleGovernanceCommitteeEligibility({
    bindingType: 'self_governed',
    targetCircleId: input.circleId,
    committeeCircleId: input.circleId,
  }, circle);
  const eligibleActors = await listCommitteeEligibleActors(tx, {
    committeeCircleId: input.circleId,
  });
  if (eligibleActors.length === 0) {
    throw new Error('governance_committee_eligible_members_required');
  }
  if (!hasGovernanceCommitteeOperator(eligibleActors)) {
    throw new Error('governance_committee_operator_required');
  }
  const overlap = await findActiveOverlappingCircleGovernanceBinding(tx, {
    targetCircleId: input.circleId,
    actionPrefix: contract.actionPrefix,
  });
  if (overlap) {
    throw new Error('governance_bootstrap_initial_authority_overlap');
  }
  const bindingId = bootstrapSelfGovernedCircleBindingId(input.circleId);
  const policyId = `${bindingId}:policy`;
  const policyVersionId = `${bindingId}:policy:v1`;
  const configDigest = digestJson(contract.rules);
  await tx.governancePolicy.create({
    data: {
      id: policyId,
      scopeType: 'circle_governance_committee',
      scopeRef: String(input.circleId),
      status: 'active',
      activeVersion: 1,
      createdByPubkey: input.actorPubkey,
      metadata: {
        bindingType: 'self_governed',
        actionScope: contract.actionPrefix,
        source: 'governance_bootstrap',
        initialAuthorityPolicyRef: contract.reference.ref,
        initialAuthorityPolicyVersion: contract.reference.version,
        initialAuthorityPolicyDigest: contract.reference.digest,
      },
    },
  });
  await tx.governancePolicyVersion.create({
    data: {
      id: policyVersionId,
      policyId,
      version: 1,
      status: 'active',
      rules: contract.rules as Prisma.InputJsonValue,
      configDigest,
      activatedAt: input.activatedAt,
      createdByPubkey: input.actorPubkey,
    },
  });
  return await tx.circleGovernanceBinding.create({
    data: {
      id: bindingId,
      bindingType: 'self_governed',
      targetCircleId: input.circleId,
      actionType: null,
      actionPrefix: contract.actionPrefix,
      committeeCircleId: input.circleId,
      policyId,
      policyVersionId,
      policyVersion: 1,
      ruleId: `committee:${contract.actionPrefix}`,
      executionMode: 'off_chain',
      status: 'active',
      activatedAt: input.activatedAt,
      createdByPubkey: input.actorPubkey,
      sourceRequestId: input.sourceRequestId ?? null,
      sourceDecisionDigest: null,
      targetAuthorizationStatus: 'accepted',
      committeeMandateStatus: 'accepted',
      authorityCanonicalState: 'legacy_canonical',
      metadata: {
        actionScope: contract.actionPrefix,
        bootstrapCeremonyId: input.ceremonyId,
        configurationBundleId: input.configurationBundleId,
        configurationBundleDigest: input.configurationBundleDigest,
        initialAuthorityPolicyRef: contract.reference.ref,
        initialAuthorityPolicyVersion: contract.reference.version,
        initialAuthorityPolicyDigest: contract.reference.digest,
        ownerOperatorFallback: 'none',
      },
    },
  }) as CircleGovernanceBindingRecord;
}

export function buildGovernanceMandateTerms(input: {
  delegatorGovernanceHome: { type: string; ref: string };
  delegateAuthority: { type: string; ref: string };
  subject: { type: string; ref: string };
  purposeBindings: Array<{
    purpose: GovernanceMandatePurpose;
    actionType?: string | null;
    actionPrefix?: string | null;
  }>;
  actionType?: string | null;
  actionPrefix?: string | null;
  operatorActors?: Array<{ pubkey: string; role?: string | null }>;
  operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints;
  effectiveFrom: Date;
  effectiveUntil: Date;
  network: GovernanceSignalChainId;
  minimumConstraints: GovernanceMandateMinimumConstraints;
  feePolicy: GovernanceMandateFeePolicy;
  effectPolicy: GovernanceMandateEffectPolicy | null;
  crossInstitutionDisclosureImpact?: {
    schemaVersion: 1;
    homeVisibility: "secret";
    dataCategories: readonly GovernanceDisclosureDataCategory[];
    recipientAuthority: { type: "circle_governance_committee"; ref: string };
    recipientRoles: readonly ("Owner" | "Admin" | "Moderator" | "Member")[];
    recipientCount: number;
    recipientRegions: readonly string[];
    purposes: readonly GovernanceDisclosurePurpose[];
    retention: { maximumDays: number; startsAt: "each_disclosure" };
    secondaryUse: "prohibited";
    revocation: "stop_future_disclosure_preserve_authorized_history";
    memberNotice?: "before_first_disclosure_and_on_terms_change";
  } | null;
}): GovernanceMandateTerms {
  normalizeActionScope(input);
  const purposeBindings = normalizeGovernanceMandatePurposeBindings(input);
  const minimumConstraints = normalizeGovernanceMandateMinimumConstraints(
    input.minimumConstraints,
  );
  if (
    Number.isNaN(input.effectiveFrom.getTime())
    || Number.isNaN(input.effectiveUntil.getTime())
    || input.effectiveUntil <= input.effectiveFrom
  ) {
    throw new Error("governance_mandate_effective_window_invalid");
  }
  return {
    schemaVersion: 1,
    delegatorGovernanceHome: normalizeMandateRef(
      input.delegatorGovernanceHome,
      "governance_mandate_delegator_home_invalid",
    ),
    delegateAuthority: normalizeMandateRef(
      input.delegateAuthority,
      "governance_mandate_delegate_authority_invalid",
    ),
    purposeBindings,
    environment: "local_development",
    network: input.network,
    subject: normalizeMandateRef(input.subject, "governance_mandate_subject_invalid"),
    actionSelector: {
      actionType: input.actionType ?? null,
      actionPrefix: input.actionPrefix ?? null,
    },
    minimumConstraints,
    feePolicy: normalizeGovernanceMandateFeePolicy(input.feePolicy),
    effectPolicy: normalizeGovernanceMandateEffectPolicy(
      input.effectPolicy,
      purposeBindings.some((binding) => binding.purpose === "operational_execution"),
      input.delegatorGovernanceHome,
    ),
    crossInstitutionDisclosureImpact: normalizeCrossInstitutionDisclosureImpact(
      input.crossInstitutionDisclosureImpact ?? null,
      input.delegateAuthority,
      purposeBindings,
    ),
    effectiveFrom: input.effectiveFrom.toISOString(),
    effectiveUntil: input.effectiveUntil.toISOString(),
  };
}

function normalizeCrossInstitutionDisclosureImpact(
  value: Parameters<typeof buildGovernanceMandateTerms>[0]["crossInstitutionDisclosureImpact"],
  delegateAuthority: { type: string; ref: string },
  purposeBindings: GovernanceMandatePurposeBinding[],
): GovernanceCrossInstitutionDisclosureImpact | null {
  if (value === null || value === undefined) return null;
  const dataCategoryOrder: GovernanceDisclosureDataCategory[] = [
    "redacted_allegation",
    "subject_reference",
    "evidence_digest",
    "operation_status",
  ];
  const roleOrder = ["Owner", "Admin", "Moderator", "Member"] as const;
  const purposeOrder: GovernanceDisclosurePurpose[] = [
    "collective_review",
    "operational_execution",
    "appeal_review",
  ];
  const dataCategories = dataCategoryOrder.filter((category) => value.dataCategories.includes(category));
  const recipientRoles = roleOrder.filter((role) => value.recipientRoles.includes(role));
  const recipientRegions = [...new Set(value.recipientRegions.map((region) => region.trim().toUpperCase()))]
    .sort();
  const purposes = purposeOrder.filter((purpose) => value.purposes.includes(purpose));
  const expectedPurposes = purposeBindings.map((binding) => (
    binding.purpose === "operational_execution" ? "operational_execution" : "collective_review"
  ));
  if (
    value.schemaVersion !== 1
    || value.homeVisibility !== "secret"
    || value.dataCategories.length !== dataCategories.length
    || dataCategories.length === 0
    || value.recipientAuthority.type !== "circle_governance_committee"
    || value.recipientAuthority.type !== delegateAuthority.type
    || value.recipientAuthority.ref !== delegateAuthority.ref
    || value.recipientRoles.length !== recipientRoles.length
    || recipientRoles.length === 0
    || !Number.isSafeInteger(value.recipientCount)
    || value.recipientCount < recipientRoles.length
    || value.recipientCount > 10_000
    || value.recipientRegions.length !== recipientRegions.length
    || recipientRegions.length === 0
    || recipientRegions.length > 16
    || recipientRegions.some((region) => !/^[A-Z]{2}$/.test(region))
    || value.purposes.length !== purposes.length
    || expectedPurposes.some((purpose) => !purposes.includes(purpose))
    || purposes.some((purpose) => purpose === "appeal_review"
      ? false
      : !expectedPurposes.includes(purpose))
    || !Number.isSafeInteger(value.retention.maximumDays)
    || value.retention.maximumDays < 1
    || value.retention.maximumDays > 3_650
    || value.retention.startsAt !== "each_disclosure"
    || value.secondaryUse !== "prohibited"
    || value.revocation !== "stop_future_disclosure_preserve_authorized_history"
    || (value.memberNotice ?? "before_first_disclosure_and_on_terms_change")
      !== "before_first_disclosure_and_on_terms_change"
  ) {
    throw new Error("governance_mandate_disclosure_impact_invalid");
  }
  return {
    schemaVersion: 1,
    homeVisibility: "secret",
    dataCategories,
    recipientAuthority: {
      type: "circle_governance_committee",
      ref: value.recipientAuthority.ref,
    },
    recipientRoles: [...recipientRoles],
    recipientCount: value.recipientCount,
    recipientRegions,
    purposes,
    retention: {
      maximumDays: value.retention.maximumDays,
      startsAt: "each_disclosure",
    },
    secondaryUse: "prohibited",
    revocation: "stop_future_disclosure_preserve_authorized_history",
    memberNotice: "before_first_disclosure_and_on_terms_change",
  };
}

export function buildGovernanceCrossInstitutionDisclosureImpact(input: {
  homeCircleType: string;
  committeeCircleId: number;
  eligibleActors: Array<{ pubkey: string; role?: string | null }>;
  purposeBindings: Array<{
    purpose: GovernanceMandatePurpose;
    actionType?: string | null;
    actionPrefix?: string | null;
  }>;
  declaration: unknown;
}): GovernanceCrossInstitutionDisclosureImpact | null {
  if (input.homeCircleType !== "Secret") {
    if (input.declaration !== null && input.declaration !== undefined) {
      throw new Error("governance_mandate_disclosure_impact_private_home_only");
    }
    return null;
  }
  const declaration = input.declaration && typeof input.declaration === "object"
    && !Array.isArray(input.declaration)
    ? input.declaration as Record<string, unknown>
    : null;
  if (!declaration) {
    throw new Error("governance_mandate_disclosure_impact_required");
  }
  const actors = [...new Map(input.eligibleActors
    .map((actor) => [String(actor.pubkey || "").trim(), actor] as const)
    .filter(([pubkey]) => Boolean(pubkey))).values()];
  const roleMap = new Map<string, "Owner" | "Admin" | "Moderator" | "Member">([
    ["owner", "Owner"],
    ["admin", "Admin"],
    ["moderator", "Moderator"],
    ["member", "Member"],
  ]);
  const recipientRoles = actors
    .map((actor) => roleMap.get(String(actor.role ?? "").trim().toLowerCase()))
    .filter((role): role is "Owner" | "Admin" | "Moderator" | "Member" => Boolean(role));
  const purposes = input.purposeBindings.flatMap((binding) => {
    const scope = binding.actionType ?? binding.actionPrefix ?? "";
    return [
      binding.purpose === "operational_execution"
        ? "operational_execution" as const
        : "collective_review" as const,
      ...(scope.split(".").includes("appeal") ? ["appeal_review" as const] : []),
    ];
  });
  return normalizeCrossInstitutionDisclosureImpact({
    schemaVersion: 1,
    homeVisibility: "secret",
    dataCategories: Array.isArray(declaration.dataCategories)
      ? declaration.dataCategories as GovernanceDisclosureDataCategory[]
      : [],
    recipientAuthority: {
      type: "circle_governance_committee",
      ref: String(input.committeeCircleId),
    },
    recipientRoles,
    recipientCount: actors.length,
    recipientRegions: Array.isArray(declaration.recipientRegions)
      ? declaration.recipientRegions.map(String)
      : [],
    purposes,
    retention: {
      maximumDays: Number(declaration.retentionDays),
      startsAt: "each_disclosure",
    },
    secondaryUse: "prohibited",
    revocation: "stop_future_disclosure_preserve_authorized_history",
    memberNotice: "before_first_disclosure_and_on_terms_change",
  }, {
    type: "circle_governance_committee",
    ref: String(input.committeeCircleId),
  }, input.purposeBindings.map((binding) => ({
    purpose: binding.purpose,
    actionSelector: {
      actionType: binding.actionType ?? null,
      actionPrefix: binding.actionPrefix ?? null,
    },
    operatorPolicy: null,
  })));
}

export function normalizeGovernanceMandateFeePolicy(value: unknown): GovernanceMandateFeePolicy {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = String(input.mode ?? "");
  const economicBearer = String(input.economicBearer ?? "");
  const maximumAmountMinor = input.maximumAmountMinor == null
    ? null
    : String(input.maximumAmountMinor);
  const unit = input.unit == null ? null : String(input.unit);
  const noFee = mode === "no_fee" && maximumAmountMinor === null && unit === null;
  const capped = mode === "capped_external_quote"
    && Boolean(maximumAmountMinor && /^[1-9][0-9]{0,29}$/.test(maximumAmountMinor))
    && Boolean(unit && /^[A-Z][A-Z0-9_]{1,15}$/.test(unit));
  if (
    (!noFee && !capped)
    || !["delegator", "delegate", "shared"].includes(economicBearer)
    || input.settlement !== "not_managed_by_mandate"
    || input.payerAuthority !== "separate_from_governance_authority"
  ) {
    throw new Error("governance_mandate_fee_policy_invalid");
  }
  return {
    mode: mode as GovernanceMandateFeePolicy["mode"],
    economicBearer: economicBearer as GovernanceMandateFeePolicy["economicBearer"],
    maximumAmountMinor,
    unit,
    settlement: "not_managed_by_mandate",
    payerAuthority: "separate_from_governance_authority",
  };
}

export function normalizeGovernanceMandateEffectPolicy(
  value: unknown,
  requiredForOperationalPurpose: boolean,
  delegatorGovernanceHome: { type: string; ref: string },
): GovernanceMandateEffectPolicy | null {
  if (!requiredForOperationalPurpose && value == null) return null;
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const fallbackAuthority = normalizeMandateRef(
    input.fallbackAuthority as { type: string; ref: string },
    "governance_mandate_effect_policy_invalid",
  );
  if (
    input.naturalExpiry !== "expire_at_mandate_end"
    || input.revoke !== "revoke_immediately"
    || input.transfer !== "supersede_immediately"
    || input.appealSurvival !== "survives_until_resolved"
    || fallbackAuthority.type !== delegatorGovernanceHome.type
    || fallbackAuthority.ref !== delegatorGovernanceHome.ref
  ) {
    throw new Error("governance_mandate_effect_policy_invalid");
  }
  return {
    naturalExpiry: "expire_at_mandate_end",
    revoke: "revoke_immediately",
    transfer: "supersede_immediately",
    appealSurvival: "survives_until_resolved",
    fallbackAuthority,
  };
}

function normalizeMandateRef(
  value: { type: string; ref: string },
  errorCode: string,
): { type: string; ref: string } {
  const type = String(value?.type ?? "").trim();
  const ref = String(value?.ref ?? "").trim();
  if (
    !/^[a-z][a-z0-9_]{1,47}$/.test(type)
    || !ref
    || ref.length > 128
    || ref !== value?.ref
  ) {
    throw new Error(errorCode);
  }
  return { type, ref };
}

function buildGovernanceMandateOperatorPolicy(input: {
  purpose: GovernanceMandatePurpose;
  actionType?: string | null;
  actionPrefix?: string | null;
  operatorActors?: Array<{ pubkey: string; role?: string | null }>;
  operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints;
}): GovernanceMandateOperatorPolicy | null {
  if (input.purpose === "collective_decision") {
    if (input.operatorActors !== undefined) {
      throw new Error("collective_governance_mandate_operator_policy_forbidden");
    }
    return null;
  }
  if (![
    "communication.member.mute",
    "communication.message.hide",
    "operator.capability.suspend",
    "content.visibility.downrank",
    "feed.ranking.policy.update",
    "feed.recommendation.experiment.start",
    "feed.recommendation.experiment.stop",
  ].includes(input.actionType ?? "") || input.actionPrefix != null) {
    throw new Error("operational_governance_mandate_exact_action_required");
  }
  const limits = normalizeGovernanceMandateOperatorPolicyConstraints(
    input.operatorPolicyConstraints
      ?? DEFAULT_GOVERNANCE_MANDATE_OPERATOR_POLICY_CONSTRAINTS,
  );
  const allowedRoles = new Set<string>(limits.roles);
  const frozenActors = (input.operatorActors ?? [])
    .map((actor) => ({
      pubkey: String(actor.pubkey ?? "").trim(),
      role: String(actor.role ?? "").trim(),
    }))
    .filter((actor) => actor.pubkey && allowedRoles.has(actor.role))
    .sort((left, right) => left.pubkey.localeCompare(right.pubkey)) as Array<{
      pubkey: string;
      role: "Owner" | "Admin" | "Moderator";
    }>;
  if (frozenActors.length === 0 || frozenActors.length > limits.maximumActors) {
    throw new Error("operational_governance_mandate_operator_set_invalid");
  }
  if (new Set(frozenActors.map((actor) => actor.pubkey)).size !== frozenActors.length) {
    throw new Error("operational_governance_mandate_operator_set_invalid");
  }
  const actorSetDigest = hashCanonicalGovernanceValue(
    "alcheme.governance.mandate-operator-set",
    frozenActors,
  );
  return {
    selector: {
      mode: "institution_roles",
      roles: limits.roles,
      frozenActors,
      actorSetDigest,
      maximumActors: limits.maximumActors,
    },
    limits,
    reauthorization: {
      mode: "exact_actor_set",
      onMembershipOrRoleDrift: "suspend_and_reauthorize",
      newMembersInheritCapability: false,
    },
    executionAuthorityRequirement: {
      type: "target_adapter",
      adapter: "communication",
      liveReadback: "required_each_invocation",
    },
    termination: {
      naturalExpiry: "stop_new_invocations",
      revoke: "suspend_immediately",
      transfer: "reauthorize_before_resume",
      appealSurvival: "survives_until_resolved",
      fallbackAuthority: "target_governance",
    },
  };
}

function normalizeGovernanceMandatePurposeBindings(input: {
  purposeBindings: Array<{
    purpose: GovernanceMandatePurpose;
    actionType?: string | null;
    actionPrefix?: string | null;
  }>;
  actionType?: string | null;
  actionPrefix?: string | null;
  operatorActors?: Array<{ pubkey: string; role?: string | null }>;
  operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints;
}): GovernanceMandatePurposeBinding[] {
  if (!Array.isArray(input.purposeBindings) || input.purposeBindings.length === 0) {
    throw new Error("governance_mandate_purpose_required");
  }
  const seen = new Set<GovernanceMandatePurpose>();
  const normalized = input.purposeBindings.map((binding) => {
    if (!["collective_decision", "operational_execution"].includes(binding.purpose)) {
      throw new Error("governance_mandate_purpose_invalid");
    }
    if (seen.has(binding.purpose)) {
      throw new Error("governance_mandate_purpose_duplicate");
    }
    seen.add(binding.purpose);
    const selector = normalizeActionScope({
      actionType: binding.actionType,
      actionPrefix: binding.actionPrefix,
    });
    if (!actionScopeContains(input, selector)) {
      throw new Error("governance_mandate_purpose_scope_outside_mandate");
    }
    return {
      purpose: binding.purpose,
      actionSelector: {
        actionType: binding.actionType ?? null,
        actionPrefix: binding.actionPrefix ?? null,
      },
      operatorPolicy: buildGovernanceMandateOperatorPolicy({
        purpose: binding.purpose,
        actionType: binding.actionType,
        actionPrefix: binding.actionPrefix,
        operatorActors: binding.purpose === "operational_execution"
          ? input.operatorActors
          : undefined,
        operatorPolicyConstraints: binding.purpose === "operational_execution"
          ? input.operatorPolicyConstraints
          : undefined,
      }),
    };
  });
  return normalized.sort((left, right) => left.purpose.localeCompare(right.purpose));
}

export function normalizeGovernanceMandateOperatorPolicyConstraints(
  value: unknown,
): GovernanceMandateOperatorPolicyConstraints {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const roleOrder = ["Owner", "Admin", "Moderator"] as const;
  const requestedRoles = Array.isArray(input.roles) ? input.roles : [];
  const roles = requestedRoles.length > 0
    ? roleOrder.filter((role) => requestedRoles.includes(role))
    : [];
  const frequency = input.frequency && typeof input.frequency === "object"
    && !Array.isArray(input.frequency)
    ? input.frequency as Record<string, unknown>
    : {};
  const appeal = input.appeal && typeof input.appeal === "object"
    && !Array.isArray(input.appeal)
    ? input.appeal as Record<string, unknown>
    : {};
  const maximumActors = Number(input.maximumActors);
  const maximumDurationSeconds = Number(input.maximumDurationSeconds);
  const windowSeconds = Number(frequency.windowSeconds);
  const maximumInvocations = Number(frequency.maximumInvocations);
  const maximumWindowSeconds = Number(appeal.maximumWindowSeconds);
  if (
    roles.length === 0
    || roles.length !== new Set(requestedRoles).size
    || !Number.isSafeInteger(maximumActors)
    || maximumActors < 1
    || maximumActors > 50
    || !Number.isSafeInteger(maximumDurationSeconds)
    || maximumDurationSeconds < 5 * 60
    || maximumDurationSeconds > 24 * 60 * 60
    || !Number.isSafeInteger(windowSeconds)
    || windowSeconds < 60
    || windowSeconds > 60 * 60
    || !Number.isSafeInteger(maximumInvocations)
    || maximumInvocations < 1
    || maximumInvocations > 100
    || !Number.isSafeInteger(maximumWindowSeconds)
    || maximumWindowSeconds < 60 * 60
    || maximumWindowSeconds > 7 * 24 * 60 * 60
    || input.targetScope !== "target_circle_exact_subject"
  ) {
    throw new Error("governance_mandate_operator_policy_constraints_invalid");
  }
  return {
    roles,
    maximumActors,
    maximumDurationSeconds,
    frequency: { windowSeconds, maximumInvocations },
    appeal: { maximumWindowSeconds },
    targetScope: "target_circle_exact_subject",
  };
}

function actionScopeContains(
  outer: { actionType?: string | null; actionPrefix?: string | null },
  innerScope: string,
): boolean {
  if (outer.actionType) return outer.actionType === innerScope;
  const prefix = outer.actionPrefix ?? "";
  return innerScope === prefix || innerScope.startsWith(`${prefix}.`);
}

export function normalizeGovernanceMandateMinimumConstraints(
  value: unknown,
): GovernanceMandateMinimumConstraints {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const riskFloor = String(input.riskFloor ?? '');
  const minimumApprovalThreshold = Number(input.minimumApprovalThreshold);
  const minimumTimelockSeconds = Number(input.minimumTimelockSeconds);
  if (
    !['low', 'medium', 'high', 'critical'].includes(riskFloor)
    || !Number.isSafeInteger(minimumApprovalThreshold)
    || minimumApprovalThreshold <= 0
    || minimumApprovalThreshold > 10_000
    || !Number.isSafeInteger(minimumTimelockSeconds)
    || minimumTimelockSeconds < 0
    || minimumTimelockSeconds > 30 * 24 * 60 * 60
  ) {
    throw new Error('governance_mandate_minimum_constraints_invalid');
  }
  return {
    riskFloor: riskFloor as GovernedActionImpact,
    minimumApprovalThreshold,
    minimumTimelockSeconds,
  };
}

export function computeGovernanceMandateTermsDigest(terms: GovernanceMandateTerms): string {
  return hashCanonicalGovernanceValue("alcheme.governance.mandate-terms", terms);
}

export function isGovernanceMandateOperatorPolicyValid(
  terms: GovernanceMandateTerms,
): boolean {
  return terms.purposeBindings.length > 0
    && terms.purposeBindings.every((binding) => {
      if (binding.purpose === "collective_decision") {
        return binding.operatorPolicy === null;
      }
      const policy = binding.operatorPolicy;
      if (!policy) return false;
      const frozenActors = policy.selector.frozenActors;
      let limits: GovernanceMandateOperatorPolicyConstraints;
      try {
        limits = normalizeGovernanceMandateOperatorPolicyConstraints(policy.limits);
      } catch {
        return false;
      }
      return ["communication.member.mute", "communication.message.hide", "operator.capability.suspend", "content.visibility.downrank", "feed.ranking.policy.update", "feed.recommendation.experiment.start", "feed.recommendation.experiment.stop"]
        .includes(binding.actionSelector.actionType ?? "")
        && binding.actionSelector.actionPrefix === null
        && policy.selector.mode === "institution_roles"
        && JSON.stringify(policy.selector.roles) === JSON.stringify(limits.roles)
        && frozenActors.length > 0
        && frozenActors.length <= policy.selector.maximumActors
        && policy.selector.maximumActors === limits.maximumActors
        && new Set(frozenActors.map((actor) => actor.pubkey)).size === frozenActors.length
        && frozenActors.every((actor) =>
          Boolean(actor.pubkey)
          && limits.roles.includes(actor.role)
        )
        && hashCanonicalGovernanceValue(
          "alcheme.governance.mandate-operator-set",
          [...frozenActors].sort((left, right) => left.pubkey.localeCompare(right.pubkey)),
        ) === policy.selector.actorSetDigest
        && policy.reauthorization.mode === "exact_actor_set"
        && policy.reauthorization.onMembershipOrRoleDrift === "suspend_and_reauthorize"
        && policy.reauthorization.newMembersInheritCapability === false
        && policy.executionAuthorityRequirement.type === "target_adapter"
        && policy.executionAuthorityRequirement.adapter === "communication"
        && policy.executionAuthorityRequirement.liveReadback === "required_each_invocation"
        && policy.termination.naturalExpiry === "stop_new_invocations"
        && policy.termination.revoke === "suspend_immediately"
        && policy.termination.transfer === "reauthorize_before_resume"
        && policy.termination.appealSurvival === "survives_until_resolved"
        && policy.termination.fallbackAuthority === "target_governance";
    });
}

export async function resolveActiveCircleGovernanceBinding(
  prisma: CircleGovernanceBindingPrisma,
  input: {
    targetCircleId: number;
    actionType: string;
    purpose?: GovernanceMandatePurpose;
    now?: Date;
    frozenCaseAuthority?: FrozenGovernanceCaseAuthorityReference;
    authorityBindingId?: string | null;
    subjectType?: string;
    subjectRef?: string;
    requireExactSubject?: boolean;
  },
): Promise<CircleGovernanceBindingResolution | null> {
  const frozen = input.frozenCaseAuthority;
  const frozenSelfBinding = frozen?.sourceType === 'circle_governance_binding';
  const selfGovernanceAction = [
    'circle.governance_binding.accept_mandate',
    'circle.governance_binding.deactivate',
    'circle.governance_binding.policy_version.update',
    'circle.governance_binding.replace',
    'circle.governance_binding.authority_health.check',
  ].includes(input.actionType);
  const selfGovernance = selfGovernanceAction
    && input.subjectType === 'circle_governance_binding'
    && input.subjectRef === input.authorityBindingId
    && Boolean(input.authorityBindingId);
  if (selfGovernanceAction && !selfGovernance && !frozen) {
    throw new Error('circle_governance_self_governance_must_be_explicit');
  }
  const rows = (await prisma.circleGovernanceBinding.findMany({
    where: frozen
      ? {
          id: frozen.projectionBindingId,
          targetCircleId: input.targetCircleId,
        }
      : selfGovernance
        ? {
            id: input.authorityBindingId,
            targetCircleId: input.targetCircleId,
            status: 'active',
            targetAuthorizationStatus: 'accepted',
            committeeMandateStatus: { in: ['accepted', 'pending'] },
          }
      : {
          targetCircleId: input.targetCircleId,
          status: "active",
          targetAuthorizationStatus: "accepted",
          committeeMandateStatus: "accepted",
        },
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      mandate: {
        include: {
          versions: frozen
            ? { where: { version: frozen.mandateVersion }, take: 1 }
            : { orderBy: { version: "desc" } },
        },
      },
    },
  })) as CircleGovernanceBindingRecord[];
  const selected = frozen || selfGovernance
    ? rows[0] ?? null
    : selectBestBinding(
        rows,
        input.actionType,
        input.requireExactSubject
          ? { subjectType: input.subjectType, subjectRef: input.subjectRef }
          : {},
      );
  if (!selected) {
    if (frozen) throw new Error("governance_case_frozen_authority_unavailable");
    return null;
  }
  const selectedCurrent = !frozen && selected.mandate
    ? {
        ...selected,
        mandate: {
          ...selected.mandate,
          versions: [selected.mandate.versions?.find(
            (version) => version.version === selected.mandate?.currentVersion,
          )].filter(Boolean) as GovernanceMandateVersionRecord[],
        },
      }
    : selected;
  if (!frozen && selected.authorityContinuityState === 'permanently_blocked_governance_authority') {
    throw new Error('permanently_blocked_governance_authority');
  }
  if (
    !frozen
    && selected.authorityContinuityState === 'manual_recovery_pending'
    && input.actionType !== 'circle.governance_binding.policy_version.update'
  ) {
    throw new Error('manual_recovery_pending');
  }
  const recovery = !frozen && prisma.governanceRecoveryPolicy?.findFirst
    ? await prisma.governanceRecoveryPolicy.findFirst({
        where: {
          OR: [
            { bindingId: selected.id },
            { targetBindingId: selected.id },
          ],
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;
  const oneRatificationCaseMayBeOpened = recovery?.ratificationStatus === 'pending'
    && recovery.ratificationCaseId == null
    && recovery.targetBindingId === selected.id
    && selfGovernance
    && input.actionType === 'circle.governance_binding.policy_version.update';
  const ratificationExpired = recovery?.ratificationStatus === 'pending'
    && recovery.ratificationDeadline
    && (input.now ?? new Date()) > new Date(recovery.ratificationDeadline);
  if (
    recovery
    && !oneRatificationCaseMayBeOpened
    && (
      recovery.ratificationStatus === 'pending'
      || recovery.ratificationStatus === 'rejected'
      || recovery.ratificationStatus === 'expired'
      || recovery.status === 'ratification_failed'
      || ratificationExpired
    )
  ) throw new Error('governance_recovery_ratification_fail_closed');
  const selectedMetadata = jsonObject(selected.metadata);
  const expectsSelfExactAuthority = selected.bindingType === 'self_governed'
    && Boolean(selected.actionType)
    && !selected.mandateId
    && Object.keys(jsonObject(selectedMetadata.exactAuthority)).length > 0;
  const selfExactAuthority = expectsSelfExactAuthority
    && prisma.actionAuthorityPolicyBinding?.findFirst
    ? await prisma.actionAuthorityPolicyBinding.findFirst({
        where: frozenSelfBinding
          ? {
              id: frozen.authorityPolicyBinding?.id,
              governanceHomeType: 'circle',
              governanceHomeRef: String(selected.targetCircleId),
              sourceType: 'circle_governance_binding',
              sourceRef: selected.id,
            }
          : {
              governanceHomeType: 'circle',
              governanceHomeRef: String(selected.targetCircleId),
              sourceType: 'circle_governance_binding',
              sourceRef: selected.id,
              status: 'active',
              supersededAt: null,
            },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      })
    : null;
  if (
    !frozenSelfBinding
    && expectsSelfExactAuthority
    && (!selfExactAuthority || selfExactAuthority.sourceRef !== selected.id)
  ) {
    throw new Error('governed_action_exact_authority_binding_unavailable');
  }
  if (frozenSelfBinding) {
    assertFrozenGovernanceCaseSelfBindingAuthority(
      selected,
      selfExactAuthority,
      frozen,
    );
  }
  const resolvedAuthorityBinding = frozenSelfBinding
    ? {
        ...selectedCurrent,
        status: 'active',
        supersededAt: null,
        authorityRetiredAt: null,
      }
    : frozen
      ? projectFrozenGovernanceCaseMandateAuthority(
          selectedCurrent,
          input.actionType,
          frozen,
          input.now ?? new Date(),
          input.purpose,
        )
      : projectCurrentMandateAuthority(
          selectedCurrent,
          input.actionType,
          input.now ?? new Date(),
          input.purpose,
          oneRatificationCaseMayBeOpened,
        );
  const selfExactSelector = jsonObject(selfExactAuthority?.selector);
  const authorityBinding = selfExactAuthority && (!selfGovernance || frozenSelfBinding)
    ? {
        ...resolvedAuthorityBinding,
        authoritySourceType: selfExactAuthority.sourceType,
        authoritySourceRef: selfExactAuthority.sourceRef,
        authoritySourceVersion: selfExactAuthority.sourceVersion,
        authorityPurpose: selfExactAuthority.purpose,
        authoritySelector: jsonObject(selfExactAuthority.selector),
        authorityLimits: jsonObject(selfExactAuthority.limits),
        authorityEffectiveFrom: new Date(selfExactAuthority.effectiveFrom),
        authorityEffectiveUntil: selfExactAuthority.effectiveUntil
          ? new Date(selfExactAuthority.effectiveUntil)
          : null,
      }
    : selfExactAuthority && selfGovernance
    ? {
        ...resolvedAuthorityBinding,
        authoritySelector: {
          environment: selfExactSelector.environment,
          network: selfExactSelector.network,
        },
      }
    : selfGovernance
    && input.actionType === 'circle.governance_binding.authority_health.check'
    && resolvedAuthorityBinding.bindingType === 'self_governed'
    ? {
        ...resolvedAuthorityBinding,
        authoritySourceType: 'circle_governance_binding',
        authoritySourceRef: resolvedAuthorityBinding.id,
        authoritySourceVersion: `${resolvedAuthorityBinding.policyVersionId}:${resolvedAuthorityBinding.ruleId}`,
        authorityPurpose: 'collective_decision',
        authorityLimits: {
          domainBindingId: resolvedAuthorityBinding.id,
          mandateId: null,
        },
      }
    : resolvedAuthorityBinding;

  const committeeCircle = (await prisma.circle.findUnique({
    where: { id: selected.committeeCircleId },
    select: {
      id: true,
      kind: true,
      mode: true,
      circleType: true,
      lifecycleStatus: true,
      parentCircleId: true,
    },
  })) as CircleGovernanceCommitteeCircle | null;
  if (!committeeCircle) {
    throw new Error("circle_governance_committee_not_found");
  }
  assertOrdinaryCircleGovernanceCommitteeEligibility(selected, committeeCircle);

  const policy = (await prisma.governancePolicy.findFirst({
    where: {
      id: authorityBinding.policyId,
      scopeType: "circle_governance_committee",
      scopeRef: String(selected.committeeCircleId),
      status: "active",
    },
    select: {
      id: true,
      scopeType: true,
      scopeRef: true,
      status: true,
    },
  })) as CircleGovernancePolicyRecord | null;
  if (!policy || policy.status !== "active") {
    throw new Error("circle_governance_policy_not_found");
  }

  const policyVersion = (await prisma.governancePolicyVersion.findFirst({
    where: {
      id: authorityBinding.policyVersionId,
      policyId: authorityBinding.policyId,
      version: authorityBinding.policyVersion,
      status: frozen ? { in: ["active", "superseded"] } : "active",
    },
    select: {
      id: true,
      policyId: true,
      version: true,
      status: true,
      rules: true,
      configDigest: true,
    },
  })) as CircleGovernancePolicyVersionRecord | null;
  if (
    !policyVersion
    || (frozen
      ? !["active", "superseded"].includes(policyVersion.status)
      : policyVersion.status !== "active")
  ) {
    throw new Error("circle_governance_policy_version_not_found");
  }

  if (!frozen && recovery) {
    if (
      recovery
      && !oneRatificationCaseMayBeOpened
      && (
        recovery.ratificationStatus === 'pending'
        || recovery.ratificationStatus === 'rejected'
        || recovery.ratificationStatus === 'expired'
        || recovery.status === 'ratification_failed'
        || ratificationExpired
      )
    ) throw new Error('governance_recovery_ratification_fail_closed');
  }

  return {
    binding: authorityBinding,
    committeeCircle,
    policy,
    policyVersion,
  };
}

export async function listCircleGovernanceBindings(
  prisma: Pick<CircleGovernanceBindingPrisma, "circleGovernanceBinding">,
  input: {
    targetCircleId: number;
  },
): Promise<CircleGovernanceBindingRecord[]> {
  return (await prisma.circleGovernanceBinding.findMany({
    where: { targetCircleId: input.targetCircleId },
    orderBy: [{ status: "asc" }, { activatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      mandate: {
        include: {
          versions: { orderBy: { version: "desc" } },
        },
      },
    },
  })) as CircleGovernanceBindingRecord[];
}

export async function listCommitteeGovernanceBindings(
  prisma: Pick<CircleGovernanceBindingPrisma, "circleGovernanceBinding">,
  input: { committeeCircleId: number },
): Promise<CircleGovernanceBindingRecord[]> {
  return (await prisma.circleGovernanceBinding.findMany({
    where: { committeeCircleId: input.committeeCircleId },
    orderBy: [{ status: "asc" }, { activatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      mandate: {
        include: {
          versions: { orderBy: { version: "desc" } },
        },
      },
    },
  })) as CircleGovernanceBindingRecord[];
}

export async function findActiveOverlappingCircleGovernanceBinding(
  prisma: Pick<CircleGovernanceBindingPrisma, "circleGovernanceBinding">,
  input: {
    targetCircleId: number;
    actionType?: string | null;
    actionPrefix?: string | null;
    excludeBindingId?: string | null;
    allowCanonicalBootstrapParentForExactAction?: boolean;
  },
): Promise<CircleGovernanceBindingRecord | null> {
  const bindings = await listCircleGovernanceBindings(prisma, {
    targetCircleId: input.targetCircleId,
  });
  return bindings.find((binding) => {
    if (binding.id === input.excludeBindingId || !bindingScopeOverlaps(binding, input)) {
      return false;
    }
    if (
      input.allowCanonicalBootstrapParentForExactAction === true
      && normalizeOptionalString(input.actionType) != null
      && normalizeOptionalString(input.actionPrefix) == null
      && isCanonicalBootstrapSelfGovernedCircleBinding(binding, input.targetCircleId)
    ) {
      return false;
    }
    return true;
  }) ?? null;
}

function isCanonicalBootstrapSelfGovernedCircleBinding(
  binding: CircleGovernanceBindingRecord,
  circleId: number,
): boolean {
  return binding.id === bootstrapSelfGovernedCircleBindingId(circleId)
    && binding.bindingType === 'self_governed'
    && binding.targetCircleId === circleId
    && binding.committeeCircleId === circleId
    && normalizeOptionalString(binding.actionType) == null
    && normalizeOptionalString(binding.actionPrefix) === 'circle';
}

export async function createLocalAuxiliaryGovernanceBinding(
  prisma: CircleGovernanceBindingWritePrisma & {
    circleMember: { findMany(input: unknown): Promise<unknown[]> };
  },
  input: {
    targetCircleId: number;
    committeeCircleId: number;
    actionType?: string | null;
    actionPrefix?: string | null;
    actorPubkey?: string | null;
    now?: Date;
    id?: string;
    sourceRequestId?: string | null;
    sourceDecisionDigest?: string | null;
    supersede?: CircleGovernanceBindingSupersedeInput | null;
    continuityIncidentResolution?: GovernanceContinuityIncidentResolution | null;
  },
): Promise<CircleGovernanceBindingRecord> {
  return createOrdinaryCircleGovernanceBinding(prisma, {
    ...input,
    bindingType: 'local_auxiliary',
  });
}

export async function createSelfGovernedExactGovernanceBinding(
  prisma: CircleGovernanceBindingWritePrisma & {
    circleMember: { findMany(input: unknown): Promise<unknown[]> };
  },
  input: {
    targetCircleId: number;
    actionType: string;
    actorPubkey: string;
    subject: { type: string; ref: string };
    network: GovernanceSignalChainId;
    effectiveFrom: Date;
    effectiveUntil: Date;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    definition: GovernedActionDefinition;
    now?: Date;
    id?: string;
    sourceRequestId: string;
    sourceDecisionDigest: string;
    supersede?: CircleGovernanceBindingSupersedeInput | null;
  },
): Promise<CircleGovernanceBindingRecord> {
  return createOrdinaryCircleGovernanceBinding(prisma, {
    ...input,
    bindingType: 'self_governed',
    committeeCircleId: input.targetCircleId,
    actionPrefix: null,
  });
}

async function createOrdinaryCircleGovernanceBinding(
  prisma: CircleGovernanceBindingWritePrisma & {
    circleMember: { findMany(input: unknown): Promise<unknown[]> };
  },
  input: {
    bindingType: 'local_auxiliary' | 'self_governed';
    targetCircleId: number;
    committeeCircleId: number;
    actionType?: string | null;
    actionPrefix?: string | null;
    actorPubkey?: string | null;
    subject?: { type: string; ref: string };
    network?: GovernanceSignalChainId;
    effectiveFrom?: Date;
    effectiveUntil?: Date;
    minimumConstraints?: GovernanceMandateMinimumConstraints;
    definition?: GovernedActionDefinition;
    now?: Date;
    id?: string;
    sourceRequestId?: string | null;
    sourceDecisionDigest?: string | null;
    supersede?: CircleGovernanceBindingSupersedeInput | null;
    continuityIncidentResolution?: GovernanceContinuityIncidentResolution | null;
  },
): Promise<CircleGovernanceBindingRecord> {
  const actionScope = normalizeActionScope(input);
  const isSelfGoverned = input.bindingType === 'self_governed';
  if (isSelfGoverned && (
    input.targetCircleId !== input.committeeCircleId
    || !input.actionType
    || input.actionPrefix != null
    || !input.subject?.type?.trim()
    || !input.subject?.ref?.trim()
    || !input.network
    || !input.effectiveFrom
    || !input.effectiveUntil
    || Number.isNaN(input.effectiveFrom.getTime())
    || Number.isNaN(input.effectiveUntil.getTime())
    || input.effectiveFrom >= input.effectiveUntil
    || !input.minimumConstraints
    || input.minimumConstraints.riskFloor !== input.definition?.impact
    || !Number.isSafeInteger(input.minimumConstraints.minimumApprovalThreshold)
    || input.minimumConstraints.minimumApprovalThreshold <= 0
    || !Number.isSafeInteger(input.minimumConstraints.minimumTimelockSeconds)
    || input.minimumConstraints.minimumTimelockSeconds < 0
    || !input.definition
    || input.definition.actionType !== input.actionType
    || !requiresExactActionAuthorityMaterialization(input.definition)
    || !input.sourceRequestId
    || !input.sourceDecisionDigest
  )) {
    throw new Error('invalid_self_governed_exact_binding');
  }
  if (
    isSelfGoverned
    && (
      !isKnownGovernedActionNetwork(input.network)
      || !resolveDeploymentAllowedNetworks().includes(input.network)
    )
  ) {
    throw new Error('governed_action_exact_binding_network_required');
  }
  const existing = await findActiveOverlappingCircleGovernanceBinding(prisma, {
    targetCircleId: input.targetCircleId,
    actionType: input.actionType,
    actionPrefix: input.actionPrefix,
    excludeBindingId: input.supersede?.bindingId,
    allowCanonicalBootstrapParentForExactAction: isSelfGoverned,
  });
  if (existing) {
    throw new Error("circle_governance_binding_replace_requires_governance");
  }
  const committeeCircle = (await prisma.circle.findUnique({
    where: { id: input.committeeCircleId },
    select: {
      id: true,
      kind: true,
      mode: true,
      circleType: true,
      lifecycleStatus: true,
      parentCircleId: true,
    },
  })) as CircleGovernanceCommitteeCircle | null;
  if (!committeeCircle) {
    throw new Error("circle_governance_committee_not_found");
  }
  assertOrdinaryCircleGovernanceCommitteeEligibility(
    {
      bindingType: input.bindingType,
      targetCircleId: input.targetCircleId,
      committeeCircleId: input.committeeCircleId,
    },
    committeeCircle,
  );
  if (!isSelfGoverned && committeeCircle.parentCircleId !== input.targetCircleId) {
    throw new Error("local_auxiliary_committee_must_be_target_child");
  }

  const eligibleActors = await listCommitteeEligibleActors(prisma, {
    committeeCircleId: input.committeeCircleId,
  });
  if (eligibleActors.length === 0) {
    throw new Error("governance_committee_eligible_members_required");
  }

  const now = input.now ?? new Date();
  if (
    isSelfGoverned
    && (
      now < input.effectiveFrom!
      || now >= input.effectiveUntil!
    )
  ) {
    throw new Error('self_governed_exact_binding_not_effective');
  }
  const bindingId = input.id ?? `circle-gov-binding:${randomUUID()}`;
  const policyId = `${bindingId}:policy`;
  const policyVersionId = `${bindingId}:policy:v1`;
  const rules = buildCommitteePolicyRules(actionScope);
  const configDigest = digestJson(rules);

  return prisma.$transaction(async (tx) => {
    const concurrentOverlap = await findActiveOverlappingCircleGovernanceBinding(tx as any, {
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      actionPrefix: input.actionPrefix,
      excludeBindingId: input.supersede?.bindingId,
      allowCanonicalBootstrapParentForExactAction: isSelfGoverned,
    });
    if (concurrentOverlap) {
      throw new Error("circle_governance_binding_replace_requires_governance");
    }
    let previousExactAuthorityBindingId: string | null = null;
    if (isSelfGoverned && input.supersede) {
      const exactTx = tx as any;
      if (!exactTx.actionAuthorityPolicyBinding?.findMany) {
        throw new Error('governed_action_exact_authority_runtime_required');
      }
      const previousAuthorities = await exactTx.actionAuthorityPolicyBinding.findMany({
        where: {
          governanceHomeType: 'circle',
          governanceHomeRef: String(input.targetCircleId),
          sourceType: 'circle_governance_binding',
          sourceRef: input.supersede.bindingId,
          status: 'active',
          supersededAt: null,
        },
      });
      const previousGovernedActionAuthorities = previousAuthorities.filter((authority: any) => {
        const selector = jsonObject(authority?.selector);
        const limits = jsonObject(authority?.limits);
        return selector.actionType === input.supersede?.actionType
          && (selector.actionPrefix ?? null) === (input.supersede?.actionPrefix ?? null)
          && limits.domainBindingId === input.supersede?.bindingId;
      });
      const allAuthoritiesBelongToSupersededDomain = previousAuthorities.every(
        (authority: any) => jsonObject(authority?.limits).domainBindingId === input.supersede?.bindingId,
      );
      if (
        previousGovernedActionAuthorities.length !== 1
        || !allAuthoritiesBelongToSupersededDomain
      ) {
        throw new Error('governed_action_exact_authority_binding_unavailable');
      }
      previousExactAuthorityBindingId = String(previousGovernedActionAuthorities[0].id ?? '');
      if (!previousExactAuthorityBindingId) {
        throw new Error('governed_action_exact_authority_binding_unavailable');
      }
    }
    if (input.supersede) {
      await supersedeCircleGovernanceBinding(tx, input.supersede, now);
    }
    await tx.governancePolicy.create({
      data: {
        id: policyId,
        scopeType: "circle_governance_committee",
        scopeRef: String(input.committeeCircleId),
        status: "active",
        activeVersion: 1,
        createdByPubkey: input.actorPubkey ?? null,
        metadata: {
          targetCircleId: input.targetCircleId,
          actionScope,
          bindingType: input.bindingType,
        },
      },
    });
    await tx.governancePolicyVersion.create({
      data: {
        id: policyVersionId,
        policyId,
        version: 1,
        status: "active",
        rules: rules as Prisma.InputJsonValue,
        configDigest,
        activatedAt: now,
        createdByPubkey: input.actorPubkey ?? null,
      },
    });
    const binding = (await tx.circleGovernanceBinding.create({
      data: {
        id: bindingId,
        bindingType: input.bindingType,
        targetCircleId: input.targetCircleId,
        actionType: input.actionType ?? null,
        actionPrefix: input.actionPrefix ?? null,
        committeeCircleId: input.committeeCircleId,
        policyId,
        policyVersionId,
        policyVersion: 1,
        ruleId: `committee:${actionScope}`,
        executionMode: "off_chain",
        status: "active",
        activatedAt: now,
        createdByPubkey: input.actorPubkey ?? null,
        sourceRequestId: input.sourceRequestId ?? null,
        sourceDecisionDigest: input.sourceDecisionDigest ?? null,
        targetAuthorizationStatus: "accepted",
        committeeMandateStatus: "accepted",
        metadata: {
          actionScope,
          supersedesBindingId: input.supersede?.bindingId ?? null,
          ...(isSelfGoverned ? {
            exactAuthority: {
              purpose: 'collective_decision',
              subject: {
                type: input.subject!.type.trim(),
                ref: input.subject!.ref.trim(),
              },
              environment: 'local_development',
              network: input.network,
              riskFloor: input.minimumConstraints!.riskFloor,
              minimumApprovalThreshold: input.minimumConstraints!.minimumApprovalThreshold,
              minimumTimelockSeconds: input.minimumConstraints!.minimumTimelockSeconds,
              effectiveFrom: input.effectiveFrom!.toISOString(),
              effectiveUntil: input.effectiveUntil!.toISOString(),
            },
          } : {}),
          ...(input.continuityIncidentResolution ? {
            continuityIncidentResolution: {
              ...input.continuityIncidentResolution,
              ratificationDecisionDigest: input.sourceDecisionDigest ?? null,
              status: 'ratified_and_active',
            },
          } : {}),
        },
      },
    })) as CircleGovernanceBindingRecord;
    if (isSelfGoverned) {
      const exactTx = tx as any;
      if (!exactTx.actionAuthorityPolicyBinding || !exactTx.governedActionContractVersion) {
        throw new Error('governed_action_exact_authority_runtime_required');
      }
      const materializedAuthority = await materializeExactActionAuthorityBinding(exactTx, {
        definition: input.definition!,
        home: { homeType: 'circle', homeRef: String(input.targetCircleId) },
        binding: {
          id: binding.id,
          targetCircleId: input.targetCircleId,
          committeeCircleId: input.committeeCircleId,
          actionType: input.actionType ?? null,
          actionPrefix: null,
          policyId,
          policyVersionId,
          policyVersion: 1,
          ruleId: `committee:${actionScope}`,
          status: 'active',
          targetAuthorizationStatus: 'accepted',
          committeeMandateStatus: 'accepted',
        },
        mandate: {
          id: binding.id,
          version: 1,
          termsDigest: configDigest,
          terms: null,
          subjectType: input.subject!.type.trim(),
          subjectRef: input.subject!.ref.trim(),
          actionType: input.actionType ?? null,
          actionPrefix: null,
          environment: 'local_development',
          network: input.network!,
          effectiveFrom: input.effectiveFrom!,
          effectiveUntil: input.effectiveUntil!,
          purposeBindings: [{
            purpose: 'collective_decision',
            actionSelector: { actionType: input.actionType ?? null, actionPrefix: null },
          }],
          minimumConstraints: {
            ...input.minimumConstraints!,
          },
        },
        authoritySource: {
          type: 'circle_governance_binding',
          ref: binding.id,
          version: `${policyVersionId}:committee:${actionScope}`,
        },
        governedSupersede: previousExactAuthorityBindingId
          ? { previousAuthorityBindingId: previousExactAuthorityBindingId }
          : null,
        now,
      }, { dryRun: false });
      if (input.supersede) {
        await retireExactActionAuthorityBindingsForDomainBinding(exactTx, {
          home: { homeType: 'circle', homeRef: String(input.targetCircleId) },
          domainBindingId: input.supersede.bindingId,
          retiredAt: now,
        });
        const [activeHomeAuthorities, activeReplacementAuthority] = await Promise.all([
          exactTx.actionAuthorityPolicyBinding.findMany({
            where: {
              governanceHomeType: 'circle',
              governanceHomeRef: String(input.targetCircleId),
              status: 'active',
              supersededAt: null,
            },
          }),
          materializedAuthority.authorityBindingId
            ? exactTx.actionAuthorityPolicyBinding.findUnique({
              where: { id: materializedAuthority.authorityBindingId },
            })
            : null,
        ]);
        const oldDomainAuthorityStillActive = activeHomeAuthorities.some(
          (authority: any) => (
            jsonObject(authority?.limits).domainBindingId === input.supersede?.bindingId
          ),
        );
        if (oldDomainAuthorityStillActive) {
          throw new Error('governed_action_exact_authority_retirement_incomplete');
        }
        if (
          !activeReplacementAuthority
          || activeReplacementAuthority.status !== 'active'
          || activeReplacementAuthority.supersededAt != null
          || activeReplacementAuthority.sourceType !== 'circle_governance_binding'
          || activeReplacementAuthority.sourceRef !== binding.id
          || jsonObject(activeReplacementAuthority.limits).domainBindingId !== binding.id
        ) {
          throw new Error('governed_action_exact_authority_materialization_incomplete');
        }
      }
    }
    return binding;
  }, { isolationLevel: "Serializable" });
}

export async function createSharedCommitteeMandateBinding(
  prisma: CircleGovernanceBindingWritePrisma & {
    governanceRequest: { create(input: unknown): Promise<unknown> };
    governanceSnapshot: { create(input: unknown): Promise<unknown> };
    governanceSignal: { create(input: unknown): Promise<unknown> };
    circleMember: { findMany(input: unknown): Promise<unknown[]> };
  },
  input: {
    targetCircleId: number;
    committeeCircleId: number;
    purposeBindings: Array<{
      purpose: GovernanceMandatePurpose;
      actionType?: string | null;
      actionPrefix?: string | null;
    }>;
    actionType?: string | null;
    actionPrefix?: string | null;
    actorPubkey: string;
    subject: { type: string; ref: string };
    effectiveFrom: Date;
    effectiveUntil: Date;
    acceptanceExpiresAt: Date;
    network: GovernanceSignalChainId;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    feePolicy: GovernanceMandateFeePolicy;
    effectPolicy: GovernanceMandateEffectPolicy | null;
    crossInstitutionDisclosureImpact?: GovernanceCrossInstitutionDisclosureImpact | null;
    operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints;
    now?: Date;
    id?: string;
    sourceRequestId?: string | null;
    sourceDecisionDigest?: string | null;
    supersede?: CircleGovernanceBindingSupersedeInput | null;
    continuityIncidentResolution?: GovernanceContinuityIncidentResolution | null;
  },
): Promise<{
  binding: CircleGovernanceBindingRecord;
  mandate: GovernanceMandateRecord;
  request: Awaited<ReturnType<typeof openGovernanceRequest>>;
}> {
  const actionScope = normalizeActionScope(input);
  const existing = await findActiveOverlappingCircleGovernanceBinding(prisma, {
    targetCircleId: input.targetCircleId,
    actionType: input.actionType,
    actionPrefix: input.actionPrefix,
    excludeBindingId: input.supersede?.bindingId,
  });
  if (existing) {
    throw new Error("circle_governance_binding_replace_requires_governance");
  }
  const committeeCircle = (await prisma.circle.findUnique({
    where: { id: input.committeeCircleId },
    select: {
      id: true,
      kind: true,
      mode: true,
      circleType: true,
      lifecycleStatus: true,
      parentCircleId: true,
    },
  })) as CircleGovernanceCommitteeCircle | null;
  if (!committeeCircle) {
    throw new Error("circle_governance_committee_not_found");
  }
  assertOrdinaryCircleGovernanceCommitteeEligibility(
    {
      bindingType: "shared_committee",
      targetCircleId: input.targetCircleId,
      committeeCircleId: input.committeeCircleId,
    },
    committeeCircle,
  );
  const committeeAuthorityBindings = await listCircleGovernanceBindings(prisma, {
    targetCircleId: input.committeeCircleId,
  });
  if (committeeAuthorityBindings.some((binding) =>
    ["active", "pending_mandate"].includes(binding.status)
    && binding.committeeCircleId !== input.committeeCircleId
  )) {
    throw new Error("governance_mandate_redelegation_forbidden");
  }

  const now = input.now ?? new Date();
  if (input.effectiveUntil <= now) {
    throw new Error("governance_mandate_effective_window_expired");
  }
  if (
    Number.isNaN(input.acceptanceExpiresAt.getTime())
    || input.acceptanceExpiresAt <= now
    || input.acceptanceExpiresAt >= input.effectiveUntil
  ) {
    throw new Error("governance_mandate_acceptance_window_invalid");
  }
  const profile = await resolveCircleGovernanceCommitteeProfile(prisma as any, {
    circleId: input.committeeCircleId,
    now,
  });
  if (
    profile.availabilityStatus !== "enabled" ||
    !profile.availabilityExpiresAt ||
    profile.availabilityExpiresAt <= now
  ) {
    throw new Error("circle_governance_committee_not_accepting_mandates");
  }
  if (!committeeReceiveWindowAcceptsActionScope(profile, actionScope, now)) {
    throw new Error("circle_governance_committee_scope_not_accepted");
  }
  const availabilityExpiresAt = profile.availabilityExpiresAt;
  if (!availabilityExpiresAt) {
    throw new Error("circle_governance_committee_not_accepting_mandates");
  }

  const eligibleActors = await listCommitteeEligibleActors(prisma, {
    committeeCircleId: input.committeeCircleId,
  });
  const targetCircle = await prisma.circle.findUnique({
    where: { id: input.targetCircleId },
    select: { circleType: true },
  }) as { circleType?: string | null } | null;
  if (!targetCircle) {
    throw new Error("circle_not_found");
  }
  const expectedDisclosureImpact = buildGovernanceCrossInstitutionDisclosureImpact({
    homeCircleType: String(targetCircle.circleType ?? ""),
    committeeCircleId: input.committeeCircleId,
    eligibleActors,
    purposeBindings: input.purposeBindings,
    declaration: input.crossInstitutionDisclosureImpact
      ? {
        dataCategories: input.crossInstitutionDisclosureImpact.dataCategories,
        recipientRegions: input.crossInstitutionDisclosureImpact.recipientRegions,
        retentionDays: input.crossInstitutionDisclosureImpact.retention.maximumDays,
      }
      : null,
  });
  if (
    hashCanonicalGovernanceValue(
      "alcheme.governance.cross-institution-disclosure-impact",
      expectedDisclosureImpact,
    ) !== hashCanonicalGovernanceValue(
      "alcheme.governance.cross-institution-disclosure-impact",
      input.crossInstitutionDisclosureImpact ?? null,
    )
  ) {
    throw new Error("governance_mandate_disclosure_impact_actor_drift");
  }
  const mandateTerms = buildGovernanceMandateTerms({
    delegatorGovernanceHome: { type: "circle", ref: String(input.targetCircleId) },
    delegateAuthority: {
      type: "circle_governance_committee",
      ref: String(input.committeeCircleId),
    },
    subject: input.subject,
    purposeBindings: input.purposeBindings,
    actionType: input.actionType,
    actionPrefix: input.actionPrefix,
    operatorActors: input.purposeBindings.some(
      (binding) => binding.purpose === "operational_execution",
    )
      ? eligibleActors
      : undefined,
    operatorPolicyConstraints: input.operatorPolicyConstraints,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    network: input.network,
    minimumConstraints: input.minimumConstraints,
    feePolicy: input.feePolicy,
    effectPolicy: input.effectPolicy,
    crossInstitutionDisclosureImpact: expectedDisclosureImpact,
  });
  const mandateTermsDigest = computeGovernanceMandateTermsDigest(mandateTerms);
  if (eligibleActors.length === 0) {
    throw new Error("governance_committee_eligible_members_required");
  }
  if (eligibleActors.length < mandateTerms.minimumConstraints.minimumApprovalThreshold) {
    throw new Error('governance_mandate_minimum_quorum_unreachable');
  }
  assertCommitteePolicyMeetsMandateMinimum(
    profile.electorateTemplate,
    eligibleActors.length,
    mandateTerms.minimumConstraints,
  );

  const bindingId = input.id ?? `circle-gov-binding:${randomUUID()}`;
  const mandateId = `governance-mandate:${randomUUID()}`;
  const mandateVersionId = `${mandateId}:v1`;
  const policyId = `${bindingId}:policy`;
  const policyVersionId = `${bindingId}:policy:v1`;
  const requestId = `${bindingId}:mandate`;
  const electorateTemplate = profile.electorateTemplate;
  const electorateTemplateDigest = digestJson(electorateTemplate);
  const rules = buildCommitteePolicyRules(actionScope, electorateTemplate);
  const configDigest = digestJson(rules);

  return prisma.$transaction(async (tx) => {
    const concurrentOverlap = await findActiveOverlappingCircleGovernanceBinding(tx as any, {
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      actionPrefix: input.actionPrefix,
      excludeBindingId: input.supersede?.bindingId,
    });
    if (concurrentOverlap) {
      throw new Error("circle_governance_binding_replace_requires_governance");
    }
    if (input.supersede) {
      await supersedeCircleGovernanceBinding(tx, input.supersede, now);
    }
    const mandate = (await tx.governanceMandate.create({
      data: {
        id: mandateId,
        delegatorGovernanceHomeType: mandateTerms.delegatorGovernanceHome.type,
        delegatorGovernanceHomeRef: mandateTerms.delegatorGovernanceHome.ref,
        delegateAuthorityType: mandateTerms.delegateAuthority.type,
        delegateAuthorityRef: mandateTerms.delegateAuthority.ref,
        bindingType: "shared_committee",
        status: "offered",
        currentVersion: 1,
        currentTermsDigest: mandateTermsDigest,
        targetAuthorizationStatus: "accepted",
        committeeAcceptanceStatus: "pending",
        acceptanceExpiresAt: input.acceptanceExpiresAt,
        createdByPubkey: input.actorPubkey,
      },
    })) as GovernanceMandateRecord;
    const mandateVersion = (await tx.governanceMandateVersion.create({
      data: {
        id: mandateVersionId,
        mandateId,
        version: 1,
        terms: mandateTerms as unknown as Prisma.InputJsonValue,
        termsDigest: mandateTermsDigest,
        purposeBindings: mandateTerms.purposeBindings as unknown as Prisma.InputJsonValue,
        environment: mandateTerms.environment,
        network: mandateTerms.network,
        subjectType: mandateTerms.subject.type,
        subjectRef: mandateTerms.subject.ref,
        actionType: mandateTerms.actionSelector.actionType,
        actionPrefix: mandateTerms.actionSelector.actionPrefix,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        targetAcceptedAt: now,
        targetAcceptedByPubkey: input.actorPubkey,
        targetAcceptedTermsDigest: mandateTermsDigest,
        createdByPubkey: input.actorPubkey,
      },
    })) as GovernanceMandateVersionRecord;
    await tx.governancePolicy.create({
      data: {
        id: policyId,
        scopeType: "circle_governance_committee",
        scopeRef: String(input.committeeCircleId),
        status: "active",
        activeVersion: 1,
        createdByPubkey: input.actorPubkey,
        metadata: {
          targetCircleId: input.targetCircleId,
          actionScope,
          bindingType: "shared_committee",
          electorateTemplate,
          electorateTemplateDigest,
        },
      },
    });
    await tx.governancePolicyVersion.create({
      data: {
        id: policyVersionId,
        policyId,
        version: 1,
        status: "active",
        rules: rules as Prisma.InputJsonValue,
        configDigest,
        activatedAt: now,
        createdByPubkey: input.actorPubkey,
      },
    });
    const createdBinding = (await tx.circleGovernanceBinding.create({
      data: {
        id: bindingId,
        bindingType: "shared_committee",
        targetCircleId: input.targetCircleId,
        actionType: input.actionType ?? null,
        actionPrefix: input.actionPrefix ?? null,
        committeeCircleId: input.committeeCircleId,
        policyId,
        policyVersionId,
        policyVersion: 1,
        ruleId: `committee:${actionScope}`,
        executionMode: "off_chain",
        status: "pending_mandate",
        createdByPubkey: input.actorPubkey,
        targetAuthorizationStatus: "accepted",
        committeeMandateStatus: "pending",
        mandateId,
        sourceRequestId: input.sourceRequestId ?? null,
        sourceDecisionDigest: input.sourceDecisionDigest ?? null,
        metadata: {
          actionScope,
          electorateTemplateDigest,
          projectionSource: "governance_mandate",
          mandateVersion: 1,
          mandateTermsDigest,
          supersedesBindingId: input.supersede?.bindingId ?? null,
          ...(input.continuityIncidentResolution ? {
            continuityIncidentResolution: {
              ...input.continuityIncidentResolution,
              ratificationDecisionDigest: input.sourceDecisionDigest ?? null,
              status: 'binding_ratified_target_acceptance_pending',
            },
          } : {}),
        },
      },
    })) as CircleGovernanceBindingRecord;
    const mandateAcceptanceAuthority = {
      id: bindingId,
      bindingType: 'shared_committee' as const,
      targetCircleId: input.targetCircleId,
      actionType: 'circle.governance_binding.accept_mandate',
      actionPrefix: null,
      committeeCircleId: input.committeeCircleId,
      policyId,
      policyVersionId,
      policyVersion: 1,
      ruleId: `committee:${actionScope}`,
      status: 'pending_mandate',
      targetAuthorizationStatus: 'accepted',
      committeeMandateStatus: 'pending',
      updatedAt: now,
      authoritySourceType: 'committee_receive_window',
      authoritySourceRef: String(input.committeeCircleId),
      authoritySourceVersion: availabilityExpiresAt.toISOString(),
      authorityPurpose: 'collective_decision',
      authorityEffectiveFrom: now,
      authorityEffectiveUntil: input.acceptanceExpiresAt,
      authoritySelector: {
        actionType: 'circle.governance_binding.accept_mandate',
        subjectType: 'circle_governance_binding',
        subjectRef: bindingId,
        mandateId,
        bindingId,
        environment: mandateTerms.environment,
        network: mandateTerms.network,
      },
      authorityLimits: {
        availabilityExpiresAt: availabilityExpiresAt.toISOString(),
        acceptanceExpiresAt: input.acceptanceExpiresAt.toISOString(),
        mandateId,
        mandateVersion: 1,
        mandateTermsDigest,
        actionScope,
        electorateTemplateDigest,
      },
    };
    const gateway = new GovernedActionGateway({
      registry: createGovernedActionRegistry({ includePhase1Defaults: true }),
      resolveBinding: async () => ({
        binding: mandateAcceptanceAuthority,
        committeeCircle,
        policy: {
          id: policyId,
          scopeType: 'circle_governance_committee',
          scopeRef: String(input.committeeCircleId),
          status: 'active',
        },
        policyVersion: {
          id: policyVersionId,
          policyId,
          version: 1,
          status: 'active',
          rules,
          configDigest,
        },
      }),
      listCommitteeEligibleActors: async () => eligibleActors,
      requestStore: createPrismaGovernanceRequestStore(tx as any),
      runtimePrisma: tx as any,
      runtimeTransactionClient: true,
      createRequestId: () => requestId,
      now: () => now,
    });
    const requestInput = {
      actionType: "circle.governance_binding.accept_mandate",
      targetType: "circle_governance_binding",
      targetRef: bindingId,
      payload: {
        bindingId,
        mandateId,
        mandateVersion: 1,
        mandateTermsDigest,
        targetCircleId: input.targetCircleId,
        committeeCircleId: input.committeeCircleId,
        actionScope,
        committeeElectorateTemplate: electorateTemplate,
        committeeElectorateTemplateDigest: electorateTemplateDigest,
        mandateTerms,
      },
      idempotencyKey: `circle-governance-mandate:${bindingId}`,
      proposerPubkey: input.actorPubkey,
      expiresAt: input.acceptanceExpiresAt,
    } as const;
    const committeeHomes = typeof (tx as any).governanceHomeIdentityBinding?.findMany === 'function'
      ? await (tx as any).governanceHomeIdentityBinding.findMany({
          where: {
            homeType: 'circle',
            homeRef: String(input.committeeCircleId),
            supersededAt: null,
          },
          include: { activationState: true },
          orderBy: { identityVersion: 'desc' },
          take: 2,
        })
      : [];
    const nativeCommitteeHome = committeeHomes.length === 1
      && committeeHomes[0]?.activationState?.state === 'active';
    const request = nativeCommitteeHome
      ? await gateway.openDecisionStageRequest({
          ...requestInput,
          targetCircleId: input.committeeCircleId,
        })
      : await gateway.openResolvedRequest({
          ...requestInput,
          targetCircleId: input.targetCircleId,
          authority: mandateAcceptanceAuthority,
          eligibleActors,
          scope: {
            type: "circle_governance_committee",
            ref: String(input.committeeCircleId),
          },
        });
    await consumeCircleGovernanceCommitteeReceiveWindow(tx as any, {
      circleId: input.committeeCircleId,
      mandateRequestId: request.id,
      now,
    });
    const binding = (await tx.circleGovernanceBinding.update({
      where: { id: bindingId },
      data: {
        committeeMandateRequestId: request.id,
      },
    })) as CircleGovernanceBindingRecord;
    return {
      binding: {
        ...createdBinding,
        ...binding,
        committeeMandateRequestId: request.id,
        mandateId,
        mandate: { ...mandate, versions: [mandateVersion] },
      },
      mandate: { ...mandate, versions: [mandateVersion] },
      request,
    };
  }, { isolationLevel: "Serializable" });
}

async function supersedeCircleGovernanceBinding(
  tx: CircleGovernanceBindingWriteTx,
  input: CircleGovernanceBindingSupersedeInput,
  supersededAt: Date,
): Promise<void> {
  const bindingUpdated = await tx.circleGovernanceBinding.updateMany({
    where: {
      id: input.bindingId,
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      actionPrefix: input.actionPrefix,
      policyVersionId: input.policyVersionId,
      policyVersion: input.policyVersion,
      status: "active",
      updatedAt: input.updatedAt,
    },
    data: {
      status: "superseded",
      supersededAt,
      authorityRetiredAt: supersededAt,
      sourceRequestId: input.sourceRequestId,
      sourceDecisionDigest: input.sourceDecisionDigest,
    },
  });
  if (bindingUpdated.count !== 1) {
    throw new Error("circle_governance_binding_supersede_stale_write");
  }
  if (!input.mandateId) return;
  const mandate = await tx.governanceMandate.findUnique({
    where: { id: input.mandateId },
  }) as GovernanceMandateRecord | null;
  const version = mandate
    ? await tx.governanceMandateVersion.findUnique({
      where: { id: `${mandate.id}:v${mandate.currentVersion}` },
    }) as GovernanceMandateVersionRecord | null
    : null;
  if (
    !mandate
    || !version
    || mandate.status !== "active"
    || mandate.currentTermsDigest !== version.termsDigest
  ) {
    throw new Error("governance_mandate_superseded_terms_mismatch");
  }
  await terminateGovernanceMandateEffectsInTransaction(tx as any, {
    mandateId: mandate.id,
    mandateSourceVersion: governanceMandateAuthoritySourceVersion(
      version.version,
      version.termsDigest,
    ),
    terms: version.terms,
    terminationKind: "transfer",
    actorPubkey: null,
    occurredAt: supersededAt,
  });
  const mandateUpdated = await tx.governanceMandate.updateMany({
    where: {
      id: input.mandateId,
      status: "active",
      targetAuthorizationStatus: "accepted",
      committeeAcceptanceStatus: "accepted",
    },
    data: { status: "deactivated" },
  });
  if (mandateUpdated.count !== 1) {
    throw new Error("governance_mandate_supersede_stale_write");
  }
}

export async function counterSharedCommitteeGovernanceMandate(
  prisma: CircleGovernanceBindingWritePrisma & {
    governanceRequest: { create(input: unknown): Promise<unknown> };
    governanceSnapshot: { create(input: unknown): Promise<unknown> };
    governanceSignal: { create(input: unknown): Promise<unknown> };
    circleMember: { findMany(input: unknown): Promise<unknown[]> };
    governanceMandate: { findUnique(input: unknown): Promise<unknown | null> };
  },
  input: {
    mandateId: string;
    committeeCircleId: number;
    actorPubkey: string;
    actionType?: string | null;
    actionPrefix?: string | null;
    effectiveFrom: Date;
    effectiveUntil: Date;
    acceptanceExpiresAt: Date;
    network: GovernanceSignalChainId;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    subject: { type: string; ref: string };
    purposeBindings: Array<{
      purpose: GovernanceMandatePurpose;
      actionType?: string | null;
      actionPrefix?: string | null;
    }>;
    feePolicy: GovernanceMandateFeePolicy;
    effectPolicy: GovernanceMandateEffectPolicy | null;
    operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints;
    crossInstitutionDisclosureDeclaration?: unknown;
    now?: Date;
  },
): Promise<{
  binding: CircleGovernanceBindingRecord;
  mandate: GovernanceMandateRecord;
  request: Awaited<ReturnType<typeof openGovernanceRequest>>;
}> {
  const current = (await prisma.governanceMandate.findUnique({
    where: { id: input.mandateId },
    include: {
      binding: true,
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  })) as (GovernanceMandateRecord & {
    binding: CircleGovernanceBindingRecord | null;
  }) | null;
  const binding = current?.binding;
  const currentVersion = current?.versions?.[0];
  if (
    !current
    || !binding
    || current.delegateAuthorityType !== "circle_governance_committee"
    || current.delegateAuthorityRef !== String(input.committeeCircleId)
    || binding.committeeCircleId !== input.committeeCircleId
    || binding.mandateId !== current.id
  ) {
    throw new Error("governance_mandate_committee_scope_mismatch");
  }
  if (
    current.status !== "offered"
    || binding.status !== "pending_mandate"
    || binding.targetAuthorizationStatus !== "accepted"
    || binding.committeeMandateStatus !== "pending"
    || current.targetAuthorizationStatus !== "accepted"
    || current.committeeAcceptanceStatus !== "pending"
    || !currentVersion
    || currentVersion.version !== current.currentVersion
    || currentVersion.termsDigest !== current.currentTermsDigest
  ) {
    throw new Error("governance_mandate_counter_state_mismatch");
  }
  const now = input.now ?? new Date();
  const eligibleActors = await listCommitteeEligibleActors(prisma, {
    committeeCircleId: input.committeeCircleId,
  });
  const committeeCircle = await prisma.circle.findUnique({
    where: { id: input.committeeCircleId },
  }) as CircleGovernanceCommitteeCircle | null;
  if (!committeeCircle) {
    throw new Error("circle_governance_committee_not_found");
  }
  const targetCircle = await prisma.circle.findUnique({
    where: { id: binding.targetCircleId },
    select: { circleType: true },
  }) as { circleType?: string | null } | null;
  if (!targetCircle) {
    throw new Error("circle_not_found");
  }
  const previousDisclosureImpact = currentVersion.terms.crossInstitutionDisclosureImpact;
  const crossInstitutionDisclosureImpact = buildGovernanceCrossInstitutionDisclosureImpact({
    homeCircleType: String(targetCircle.circleType ?? ""),
    committeeCircleId: input.committeeCircleId,
    eligibleActors,
    purposeBindings: input.purposeBindings,
    declaration: input.crossInstitutionDisclosureDeclaration ?? (previousDisclosureImpact
      ? {
        dataCategories: previousDisclosureImpact.dataCategories,
        recipientRegions: previousDisclosureImpact.recipientRegions,
        retentionDays: previousDisclosureImpact.retention.maximumDays,
      }
      : null),
  });
  const mandateTerms = buildGovernanceMandateTerms({
    delegatorGovernanceHome: {
      type: current.delegatorGovernanceHomeType,
      ref: current.delegatorGovernanceHomeRef,
    },
    delegateAuthority: {
      type: current.delegateAuthorityType,
      ref: current.delegateAuthorityRef,
    },
    subject: input.subject,
    purposeBindings: input.purposeBindings,
    actionType: input.actionType,
    actionPrefix: input.actionPrefix,
    operatorActors: input.purposeBindings.some(
      (binding) => binding.purpose === "operational_execution",
    )
      ? eligibleActors
      : undefined,
    operatorPolicyConstraints: input.operatorPolicyConstraints,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    network: input.network,
    minimumConstraints: input.minimumConstraints,
    feePolicy: input.feePolicy,
    effectPolicy: input.effectPolicy,
    crossInstitutionDisclosureImpact,
  });
  const mandateTermsDigest = computeGovernanceMandateTermsDigest(mandateTerms);
  if (mandateTermsDigest === current.currentTermsDigest) {
    throw new Error("governance_mandate_counter_terms_unchanged");
  }
  if (
    input.effectiveUntil <= now
    || Number.isNaN(input.acceptanceExpiresAt.getTime())
    || input.acceptanceExpiresAt <= now
    || input.acceptanceExpiresAt >= input.effectiveUntil
  ) {
    throw new Error("governance_mandate_acceptance_window_invalid");
  }
  const overlapping = (await listCircleGovernanceBindings(prisma, {
    targetCircleId: binding.targetCircleId,
  })).find((candidate) =>
    candidate.id !== binding.id
    && bindingScopeOverlaps(candidate, {
      actionType: input.actionType,
      actionPrefix: input.actionPrefix,
    })
  );
  if (overlapping) {
    throw new Error("circle_governance_binding_replace_requires_governance");
  }
  if (eligibleActors.length === 0) {
    throw new Error("governance_committee_eligible_members_required");
  }
  if (eligibleActors.length < mandateTerms.minimumConstraints.minimumApprovalThreshold) {
    throw new Error('governance_mandate_minimum_quorum_unreachable');
  }
  const committeeProfile = await resolveCircleGovernanceCommitteeProfile(prisma as any, {
    circleId: input.committeeCircleId,
    now,
  });
  assertCommitteePolicyMeetsMandateMinimum(
    committeeProfile.electorateTemplate,
    eligibleActors.length,
    mandateTerms.minimumConstraints,
  );
  const nextVersion = current.currentVersion + 1;
  const versionId = `${current.id}:v${nextVersion}`;
  const requestId = `${binding.id}:mandate:v${nextVersion}`;

  return prisma.$transaction(async (tx) => {
    const version = (await tx.governanceMandateVersion.create({
      data: {
        id: versionId,
        mandateId: current.id,
        version: nextVersion,
        terms: mandateTerms as unknown as Prisma.InputJsonValue,
        termsDigest: mandateTermsDigest,
        purposeBindings: mandateTerms.purposeBindings as unknown as Prisma.InputJsonValue,
        environment: mandateTerms.environment,
        network: mandateTerms.network,
        subjectType: mandateTerms.subject.type,
        subjectRef: mandateTerms.subject.ref,
        actionType: mandateTerms.actionSelector.actionType,
        actionPrefix: mandateTerms.actionSelector.actionPrefix,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        createdByPubkey: input.actorPubkey,
      },
    })) as GovernanceMandateVersionRecord;
    const mandateUpdated = await tx.governanceMandate.updateMany({
      where: {
        id: current.id,
        status: "offered",
        currentVersion: current.currentVersion,
        currentTermsDigest: current.currentTermsDigest,
        targetAuthorizationStatus: "accepted",
        committeeAcceptanceStatus: "pending",
      },
      data: {
        status: "countered",
        currentVersion: nextVersion,
        currentTermsDigest: mandateTermsDigest,
        targetAuthorizationStatus: "pending",
        committeeAcceptanceStatus: "pending",
        acceptanceExpiresAt: input.acceptanceExpiresAt,
        activatedAt: null,
      },
    });
    if (mandateUpdated.count !== 1) {
      throw new Error("governance_mandate_counter_stale_write");
    }
    const bindingUpdated = await tx.circleGovernanceBinding.updateMany({
      where: {
        id: binding.id,
        mandateId: current.id,
        status: "pending_mandate",
        targetAuthorizationStatus: "accepted",
        committeeMandateStatus: "pending",
      },
      data: {
        actionType: mandateTerms.actionSelector.actionType,
        actionPrefix: mandateTerms.actionSelector.actionPrefix,
        status: "pending_mandate",
        targetAuthorizationStatus: "pending",
        committeeMandateStatus: "pending",
        activatedAt: null,
        sourceRequestId: null,
        sourceDecisionDigest: null,
        authorityCanonicalState: "legacy_canonical",
        shadowComparedAt: null,
        mandateCanonicalAt: null,
        authorityRetiredAt: null,
        metadata: {
          ...(binding.metadata && typeof binding.metadata === "object" ? binding.metadata : {}),
          projectionSource: "governance_mandate",
          mandateVersion: nextVersion,
          mandateTermsDigest,
        },
      },
    });
    if (bindingUpdated.count !== 1) {
      throw new Error("governance_mandate_counter_binding_stale_write");
    }
    const counterAuthority = {
      id: `mandate-counter:${current.id}:v${nextVersion}`,
      bindingType: 'shared_committee' as const,
      targetCircleId: binding.targetCircleId,
      actionType: 'circle.governance_binding.accept_mandate',
      actionPrefix: null,
      committeeCircleId: binding.committeeCircleId,
      policyId: binding.policyId,
      policyVersionId: binding.policyVersionId,
      policyVersion: binding.policyVersion,
      ruleId: `committee:${input.actionType ?? input.actionPrefix}`,
      status: 'pending_mandate',
      targetAuthorizationStatus: 'pending',
      committeeMandateStatus: 'pending',
      updatedAt: now,
      authoritySourceType: "governance_mandate_counter",
      authoritySourceRef: current.id,
      authoritySourceVersion: String(nextVersion),
      authorityPurpose: "collective_decision",
      authoritySelector: {
        actionType: "circle.governance_binding.accept_mandate",
        targetCircleId: binding.targetCircleId,
        committeeCircleId: binding.committeeCircleId,
        environment: mandateTerms.environment,
        network: mandateTerms.network,
      },
      authorityLimits: {
        acceptanceExpiresAt: input.acceptanceExpiresAt.toISOString(),
        mandateTermsDigest,
      },
    };
    const counterRules = buildCommitteePolicyRules(
      input.actionType ?? input.actionPrefix ?? '',
      committeeProfile.electorateTemplate,
    );
    const gateway = new GovernedActionGateway({
      registry: createGovernedActionRegistry({ includePhase1Defaults: true }),
      resolveBinding: async () => ({
        binding: counterAuthority,
        committeeCircle,
        policy: {
          id: binding.policyId,
          scopeType: 'circle_governance_committee',
          scopeRef: String(binding.committeeCircleId),
          status: 'active',
        },
        policyVersion: {
          id: binding.policyVersionId,
          policyId: binding.policyId,
          version: binding.policyVersion,
          status: 'active',
          rules: counterRules,
          configDigest: digestJson(counterRules),
        },
      }),
      listCommitteeEligibleActors: async () => eligibleActors,
      requestStore: createPrismaGovernanceRequestStore(tx as any),
      runtimePrisma: tx as any,
      runtimeTransactionClient: true,
      createRequestId: () => requestId,
      now: () => now,
    });
    const requestInput = {
      actionType: "circle.governance_binding.accept_mandate",
      targetType: "circle_governance_binding",
      targetRef: binding.id,
      payload: {
        bindingId: binding.id,
        mandateId: current.id,
        mandateVersion: nextVersion,
        mandateTermsDigest,
        targetCircleId: binding.targetCircleId,
        committeeCircleId: binding.committeeCircleId,
        actionScope: input.actionType ?? input.actionPrefix,
        mandateTerms,
      },
      idempotencyKey: `circle-governance-mandate:${binding.id}:v${nextVersion}`,
      proposerPubkey: input.actorPubkey,
      expiresAt: input.acceptanceExpiresAt,
    } as const;
    const committeeHomes = typeof (tx as any).governanceHomeIdentityBinding?.findMany === 'function'
      ? await (tx as any).governanceHomeIdentityBinding.findMany({
          where: {
            homeType: 'circle',
            homeRef: String(binding.committeeCircleId),
            supersededAt: null,
          },
          include: { activationState: true },
          orderBy: { identityVersion: 'desc' },
          take: 2,
        })
      : [];
    const nativeCommitteeHome = committeeHomes.length === 1
      && committeeHomes[0]?.activationState?.state === 'active';
    const request = nativeCommitteeHome
      ? await gateway.openDecisionStageRequest({
          ...requestInput,
          targetCircleId: binding.committeeCircleId,
        })
      : await gateway.openResolvedRequest({
          ...requestInput,
          targetCircleId: binding.targetCircleId,
          authority: counterAuthority,
          eligibleActors,
          scope: {
            type: "circle_governance_committee",
            ref: String(binding.committeeCircleId),
          },
        });
    await tx.circleGovernanceBinding.update({
      where: { id: binding.id },
      data: { committeeMandateRequestId: request.id },
    });
    return {
      binding: {
        ...binding,
        actionType: mandateTerms.actionSelector.actionType,
        actionPrefix: mandateTerms.actionSelector.actionPrefix,
        status: "pending_mandate",
        targetAuthorizationStatus: "pending",
        committeeMandateStatus: "pending",
        committeeMandateRequestId: request.id,
        mandate: {
          ...current,
          status: "countered",
          currentVersion: nextVersion,
          currentTermsDigest: mandateTermsDigest,
          targetAuthorizationStatus: "pending",
          committeeAcceptanceStatus: "pending",
          acceptanceExpiresAt: input.acceptanceExpiresAt,
          versions: [version],
        },
      },
      mandate: {
        ...current,
        status: "countered",
        currentVersion: nextVersion,
        currentTermsDigest: mandateTermsDigest,
        targetAuthorizationStatus: "pending",
        committeeAcceptanceStatus: "pending",
        acceptanceExpiresAt: input.acceptanceExpiresAt,
        versions: [version],
      },
      request,
    };
  });
}

export async function acceptGovernanceMandateCounterByTarget(
  prisma: CircleGovernanceBindingWritePrisma & {
    governanceMandate: { findUnique(input: unknown): Promise<unknown | null> };
  },
  input: {
    mandateId: string;
    targetCircleId: number;
    version: number;
    termsDigest: string;
    actorPubkey: string;
    signedMessage: string;
    signature: string;
    nonce: string;
    signatureExpiresAt: Date;
    now?: Date;
  },
): Promise<GovernanceMandateRecord> {
  const current = (await prisma.governanceMandate.findUnique({
    where: { id: input.mandateId },
    include: {
      binding: true,
      versions: { where: { version: input.version }, take: 1 },
    },
  })) as (GovernanceMandateRecord & {
    binding: CircleGovernanceBindingRecord | null;
  }) | null;
  const binding = current?.binding;
  const version = current?.versions?.[0];
  const now = input.now ?? new Date();
  if (
    !current
    || !binding
    || current.delegatorGovernanceHomeType !== "circle"
    || current.delegatorGovernanceHomeRef !== String(input.targetCircleId)
    || binding.targetCircleId !== input.targetCircleId
    || binding.mandateId !== current.id
  ) {
    throw new Error("governance_mandate_target_scope_mismatch");
  }
  const committeeAlreadyAccepted = Boolean(
    current.committeeAcceptanceStatus === 'accepted'
    && binding.committeeMandateStatus === 'accepted'
    && version?.committeeAcceptedTermsDigest === input.termsDigest
  );
  const committeeStillPending = Boolean(
    current.committeeAcceptanceStatus === 'pending'
    && binding.committeeMandateStatus === 'pending'
    && version?.committeeAcceptedTermsDigest === null
  );
  if (
    current.status !== "countered"
    || current.currentVersion !== input.version
    || current.currentTermsDigest !== input.termsDigest
    || current.targetAuthorizationStatus !== "pending"
    || (!committeeAlreadyAccepted && !committeeStillPending)
    || !version
    || version.termsDigest !== input.termsDigest
    || version.targetAcceptedTermsDigest !== null
    || now >= new Date(current.acceptanceExpiresAt)
  ) {
    throw new Error("governance_mandate_counter_acceptance_mismatch");
  }
  return prisma.$transaction(async (tx) => {
    const versionUpdated = await tx.governanceMandateVersion.updateMany({
      where: {
        id: version.id,
        mandateId: current.id,
        version: input.version,
        termsDigest: input.termsDigest,
        targetAcceptedTermsDigest: null,
        committeeAcceptedTermsDigest: committeeAlreadyAccepted ? input.termsDigest : null,
      },
      data: {
        targetAcceptedAt: now,
        targetAcceptedByPubkey: input.actorPubkey,
        targetAcceptedTermsDigest: input.termsDigest,
        targetAcceptanceSignedMessage: input.signedMessage,
        targetAcceptanceSignature: input.signature,
        targetAcceptanceNonce: input.nonce,
        targetAcceptanceExpiresAt: input.signatureExpiresAt,
      },
    });
    if (versionUpdated.count !== 1) {
      throw new Error("governance_mandate_counter_version_stale_write");
    }
    const mandateUpdated = await tx.governanceMandate.updateMany({
      where: {
        id: current.id,
        status: "countered",
        currentVersion: input.version,
        currentTermsDigest: input.termsDigest,
        targetAuthorizationStatus: "pending",
        committeeAcceptanceStatus: committeeAlreadyAccepted ? 'accepted' : 'pending',
      },
      data: committeeAlreadyAccepted
        ? {
            status: 'active',
            targetAuthorizationStatus: 'accepted',
            activatedAt: now,
          }
        : { targetAuthorizationStatus: "accepted" },
    });
    if (mandateUpdated.count !== 1) {
      throw new Error("governance_mandate_counter_stale_write");
    }
    const bindingUpdated = await tx.circleGovernanceBinding.updateMany({
      where: {
        id: binding.id,
        mandateId: current.id,
        status: "pending_mandate",
        targetAuthorizationStatus: "pending",
        committeeMandateStatus: committeeAlreadyAccepted ? 'accepted' : 'pending',
      },
      data: committeeAlreadyAccepted
        ? {
            status: 'active',
            targetAuthorizationStatus: 'accepted',
            activatedAt: now,
            authorityCanonicalState: 'mandate_canonical',
            shadowComparedAt: now,
            mandateCanonicalAt: now,
            authorityRetiredAt: null,
          }
        : { targetAuthorizationStatus: "accepted" },
    });
    if (bindingUpdated.count !== 1) {
      throw new Error("governance_mandate_counter_binding_stale_write");
    }
    return {
      ...current,
      status: committeeAlreadyAccepted ? 'active' : current.status,
      targetAuthorizationStatus: "accepted",
      activatedAt: committeeAlreadyAccepted ? now : current.activatedAt,
      versions: [{
        ...version,
        targetAcceptedAt: now,
        targetAcceptedByPubkey: input.actorPubkey,
        targetAcceptedTermsDigest: input.termsDigest,
      }],
    };
  });
}

function selectBestBinding(
  rows: CircleGovernanceBindingRecord[],
  actionType: string,
  subject: { subjectType?: string; subjectRef?: string } = {},
): CircleGovernanceBindingRecord | null {
  const candidates = rows.filter((row) => {
    if (
      row.status !== "active" ||
      row.targetAuthorizationStatus !== "accepted" ||
      row.committeeMandateStatus !== "accepted"
    ) {
      return false;
    }
    const exact = row.actionType && row.actionType === actionType;
    const prefix =
      row.actionPrefix &&
      (actionType === row.actionPrefix ||
        actionType.startsWith(`${row.actionPrefix}.`));
    if (!exact && !prefix) return false;
    if (!subject.subjectType && !subject.subjectRef) return true;
    if (!subject.subjectType || !subject.subjectRef) return false;
    const currentMandateVersion = row.mandate?.versions?.find((version) =>
      version.version === row.mandate?.currentVersion);
    const exactAuthority = jsonObject(jsonObject(row.metadata).exactAuthority);
    const exactSubject = jsonObject(exactAuthority.subject);
    const selector = row.authoritySelector ?? {};
    const boundSubjectType = String(
      currentMandateVersion?.terms?.subject?.type
      ?? exactSubject.type
      ?? selector.subjectType
      ?? '',
    );
    const boundSubjectRef = String(
      currentMandateVersion?.terms?.subject?.ref
      ?? exactSubject.ref
      ?? selector.subjectRef
      ?? '',
    );
    return boundSubjectType === subject.subjectType
      && boundSubjectRef === subject.subjectRef;
  });
  candidates.sort((left, right) => {
    const leftExact = left.actionType === actionType ? 1 : 0;
    const rightExact = right.actionType === actionType ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    const leftPrefixLength = left.actionPrefix?.length ?? 0;
    const rightPrefixLength = right.actionPrefix?.length ?? 0;
    if (leftPrefixLength !== rightPrefixLength) {
      return rightPrefixLength - leftPrefixLength;
    }
    const leftTime = left.activatedAt?.getTime?.() ?? 0;
    const rightTime = right.activatedAt?.getTime?.() ?? 0;
    return rightTime - leftTime;
  });
  return candidates[0] ?? null;
}

function projectCurrentMandateAuthority(
  binding: CircleGovernanceBindingRecord,
  actionType: string,
  now: Date,
  purpose?: GovernanceMandatePurpose,
  allowRecoveryPendingRatification = false,
): CircleGovernanceBindingRecord {
  if (binding.bindingType !== "shared_committee" && !binding.mandateId) return binding;
  const mandate = binding.mandate;
  const version = mandate?.versions?.[0];
  if (!mandate || !version) {
    throw new Error("governance_mandate_authority_not_current");
  }
  assertGovernanceMandateProjectionMatch(binding, mandate, version);
  const effectiveFrom = new Date(String(version?.effectiveFrom ?? "invalid"));
  const effectiveUntil = new Date(String(version?.effectiveUntil ?? "invalid"));
  if (
    !binding.mandateId
    || !mandate
    || mandate.id !== binding.mandateId
    || mandate.status !== "active"
    || mandate.targetAuthorizationStatus !== "accepted"
    || (
      mandate.committeeAcceptanceStatus !== "accepted"
      && !(
        allowRecoveryPendingRatification
        && mandate.committeeAcceptanceStatus === 'pending'
      )
    )
    || !version
    || version.mandateId !== mandate.id
    || version.version !== mandate.currentVersion
    || version.termsDigest !== mandate.currentTermsDigest
    || version.targetAcceptedTermsDigest !== mandate.currentTermsDigest
    || (
      version.committeeAcceptedTermsDigest !== mandate.currentTermsDigest
      && !(allowRecoveryPendingRatification && version.committeeAcceptedTermsDigest == null)
    )
    || binding.authorityCanonicalState !== "mandate_canonical"
    || !binding.shadowComparedAt
    || !binding.mandateCanonicalAt
    || Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || now < effectiveFrom
    || now >= effectiveUntil
  ) {
    throw new Error("governance_mandate_authority_not_current");
  }
  if (
    !isKnownGovernedActionNetwork(version.terms.network)
    || !resolveDeploymentAllowedNetworks().includes(version.terms.network)
  ) {
    throw new Error("governance_mandate_network_not_enabled");
  }
  return projectMandateAuthorityVersion(binding, mandate, version, actionType, purpose);
}

function projectFrozenGovernanceCaseMandateAuthority(
  binding: CircleGovernanceBindingRecord,
  actionType: string,
  frozen: FrozenGovernanceCaseAuthorityReference,
  now: Date,
  purpose?: GovernanceMandatePurpose,
): CircleGovernanceBindingRecord {
  const mandate = binding.mandate;
  const version = mandate?.versions?.[0];
  const openedAt = frozen.openedAt;
  const activatedAt = binding.activatedAt instanceof Date
    ? binding.activatedAt
    : new Date(String(binding.activatedAt ?? "invalid"));
  const supersededAt = binding.supersededAt instanceof Date
    ? binding.supersededAt
    : binding.supersededAt
      ? new Date(String(binding.supersededAt))
      : null;
  const authorityRetiredAt = binding.authorityRetiredAt instanceof Date
    ? binding.authorityRetiredAt
    : binding.authorityRetiredAt
      ? new Date(String(binding.authorityRetiredAt))
      : null;
  const recoveryPendingRatification = binding.committeeMandateStatus === 'pending'
    && mandate?.committeeAcceptanceStatus === 'pending';
  if (
    !mandate
    || !version
    || Number.isNaN(openedAt.getTime())
    || Number.isNaN(now.getTime())
    || frozen.projectionBindingId !== binding.id
    || frozen.mandateId !== mandate.id
    || frozen.mandateVersion !== version.version
    || frozen.mandateTermsDigest !== version.termsDigest
    || frozen.policy.id !== binding.policyId
    || frozen.policy.versionId.length === 0
    || !Number.isSafeInteger(frozen.policy.version)
    || frozen.policy.version <= 0
    || frozen.policy.ruleId.length === 0
    || binding.bindingType !== "shared_committee"
    || !["active", "deactivated", "superseded"].includes(mandate.status)
    || binding.authorityCanonicalState !== "mandate_canonical"
    || !binding.shadowComparedAt
    || !binding.mandateCanonicalAt
    || !["active", "deactivated", "superseded"].includes(binding.status)
    || binding.targetAuthorizationStatus !== "accepted"
    || (binding.committeeMandateStatus !== "accepted" && !recoveryPendingRatification)
    || Number.isNaN(activatedAt.getTime())
    || openedAt < activatedAt
    || (supersededAt && (Number.isNaN(supersededAt.getTime()) || openedAt >= supersededAt))
    || (binding.status === "deactivated" && !supersededAt)
    || (authorityRetiredAt
      && (
        Number.isNaN(authorityRetiredAt.getTime())
        || openedAt >= authorityRetiredAt
        || binding.status !== "superseded"
        || !supersededAt
      ))
    || version.targetAcceptedTermsDigest !== version.termsDigest
    || (
      version.committeeAcceptedTermsDigest !== version.termsDigest
      && !(recoveryPendingRatification && version.committeeAcceptedTermsDigest == null)
    )
  ) {
    throw new Error("governance_case_frozen_authority_unavailable");
  }
  assertGovernanceMandateVersionMatch(binding, mandate, version, false);
  const effectiveFrom = new Date(version.terms.effectiveFrom);
  const effectiveUntil = new Date(version.terms.effectiveUntil);
  const selector = version.terms.actionSelector;
  const selectorMatches = selector.actionType === actionType
    || Boolean(selector.actionPrefix && (
      actionType === selector.actionPrefix
      || actionType.startsWith(`${selector.actionPrefix}.`)
    ));
  const mandateSelfGovernance = [
    'circle.governance_binding.accept_mandate',
    'circle.governance_binding.deactivate',
    'circle.governance_binding.policy_version.update',
    'circle.governance_binding.replace',
  ].includes(actionType)
    && frozen.subjectType === 'circle_governance_binding'
    && frozen.subjectRef === binding.id;
  if (
    !isKnownGovernedActionNetwork(version.terms.network)
    || !resolveDeploymentAllowedNetworks().includes(version.terms.network)
    || Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || openedAt < effectiveFrom
    || openedAt >= effectiveUntil
    || (!selectorMatches && !mandateSelfGovernance)
  ) {
    throw new Error("governance_case_frozen_authority_unavailable");
  }
  return projectMandateAuthorityVersion({
    ...binding,
    policyId: frozen.policy.id,
    policyVersionId: frozen.policy.versionId,
    policyVersion: frozen.policy.version,
    ruleId: frozen.policy.ruleId,
  }, mandate, version, actionType, purpose);
}

function assertFrozenGovernanceCaseSelfBindingAuthority(
  binding: CircleGovernanceBindingRecord,
  authorityPolicyBinding: any,
  frozen: FrozenGovernanceCaseAuthorityReference,
): void {
  const openedAt = frozen.openedAt;
  const activatedAt = binding.activatedAt instanceof Date
    ? binding.activatedAt
    : new Date(String(binding.activatedAt ?? 'invalid'));
  const supersededAt = binding.supersededAt instanceof Date
    ? binding.supersededAt
    : binding.supersededAt
      ? new Date(String(binding.supersededAt))
      : null;
  const authorityRetiredAt = binding.authorityRetiredAt instanceof Date
    ? binding.authorityRetiredAt
    : binding.authorityRetiredAt
      ? new Date(String(binding.authorityRetiredAt))
      : null;
  const exactSupersededAt = authorityPolicyBinding?.supersededAt instanceof Date
    ? authorityPolicyBinding.supersededAt
    : authorityPolicyBinding?.supersededAt
      ? new Date(String(authorityPolicyBinding.supersededAt))
      : null;
  const effectiveFrom = new Date(String(authorityPolicyBinding?.effectiveFrom ?? 'invalid'));
  const effectiveUntil = authorityPolicyBinding?.effectiveUntil == null
    ? null
    : new Date(String(authorityPolicyBinding.effectiveUntil));
  const frozenPolicyBinding = frozen.authorityPolicyBinding;
  const replacedAfterOpening = Boolean(
    supersededAt
    && !Number.isNaN(supersededAt.getTime())
    && openedAt < supersededAt,
  );
  if (
    frozen.sourceType !== 'circle_governance_binding'
    || !frozenPolicyBinding
    || Number.isNaN(openedAt.getTime())
    || Number.isNaN(activatedAt.getTime())
    || frozen.projectionBindingId !== binding.id
    || binding.bindingType !== 'self_governed'
    || !['active', 'deactivated', 'superseded'].includes(binding.status)
    || binding.targetAuthorizationStatus !== 'accepted'
    || binding.committeeMandateStatus !== 'accepted'
    || openedAt < activatedAt
    || (binding.status !== 'active'
      && (binding.status !== 'superseded' || !replacedAfterOpening))
    || (authorityRetiredAt
      && (
        Number.isNaN(authorityRetiredAt.getTime())
        || openedAt >= authorityRetiredAt
        || binding.status !== 'superseded'
        || !replacedAfterOpening
      ))
    || binding.authorityContinuityState === 'permanently_blocked_governance_authority'
    || !authorityPolicyBinding
    || authorityPolicyBinding.id !== frozenPolicyBinding.id
    || authorityPolicyBinding.bindingDigest !== frozenPolicyBinding.bindingDigest
    || authorityPolicyBinding.sourceType !== 'circle_governance_binding'
    || authorityPolicyBinding.sourceRef !== binding.id
    || authorityPolicyBinding.sourceRef !== frozenPolicyBinding.sourceRef
    || (authorityPolicyBinding.sourceVersion ?? null) !== frozenPolicyBinding.sourceVersion
    || authorityPolicyBinding.purpose !== frozenPolicyBinding.purpose
    || !['active', 'superseded'].includes(String(authorityPolicyBinding.status ?? ''))
    || (authorityPolicyBinding.status === 'superseded'
      && (!exactSupersededAt
        || Number.isNaN(exactSupersededAt.getTime())
        || openedAt >= exactSupersededAt))
    || Number.isNaN(effectiveFrom.getTime())
    || openedAt < effectiveFrom
    || (effectiveUntil
      && (Number.isNaN(effectiveUntil.getTime()) || openedAt >= effectiveUntil))
  ) {
    throw new Error('governance_case_frozen_authority_unavailable');
  }
}

function projectMandateAuthorityVersion(
  binding: CircleGovernanceBindingRecord,
  mandate: GovernanceMandateRecord,
  version: GovernanceMandateVersionRecord,
  actionType: string,
  purpose?: GovernanceMandatePurpose,
): CircleGovernanceBindingRecord {
  const effectiveFrom = new Date(version.terms.effectiveFrom);
  const effectiveUntil = new Date(version.terms.effectiveUntil);
  const mandateSelfGovernance = [
    'circle.governance_binding.accept_mandate',
    'circle.governance_binding.deactivate',
    'circle.governance_binding.policy_version.update',
    'circle.governance_binding.replace',
  ].includes(actionType);
  const matchingPurposes = version.terms.purposeBindings.filter((candidate) =>
    (!purpose || candidate.purpose === purpose)
    && (
      actionSelectorMatches(candidate.actionSelector, actionType)
      || (mandateSelfGovernance && candidate.purpose === 'collective_decision')
    )
  );
  if (purpose && matchingPurposes.length !== 1) {
    throw new Error("governance_mandate_exact_purpose_unavailable");
  }
  const selectedPurpose = matchingPurposes.length === 1 ? matchingPurposes[0] : null;
  return {
    ...binding,
    authoritySourceType: "governance_mandate",
    authoritySourceRef: mandate.id,
    authoritySourceVersion: governanceMandateAuthoritySourceVersion(
      version.version,
      version.termsDigest,
    ),
    authorityPurpose: selectedPurpose?.purpose,
    authoritySelector: {
      actionType: selectedPurpose?.actionSelector.actionType
        ?? version.terms.actionSelector.actionType,
      actionPrefix: selectedPurpose?.actionSelector.actionPrefix
        ?? version.terms.actionSelector.actionPrefix,
      declaredPurposes: version.terms.purposeBindings.map((item) => item.purpose),
      subjectType: version.terms.subject.type,
      subjectRef: version.terms.subject.ref,
      environment: version.terms.environment,
      network: version.terms.network,
      operatorSelector: selectedPurpose?.operatorPolicy?.selector ?? null,
    },
    authorityLimits: {
      mandateId: mandate.id,
      mandateVersion: version.version,
      mandateTermsDigest: version.termsDigest,
      delegatorGovernanceHome: { ...version.terms.delegatorGovernanceHome },
      delegateAuthority: { ...version.terms.delegateAuthority },
      targetCircleId: binding.targetCircleId,
      committeeCircleId: binding.committeeCircleId,
      riskFloor: version.terms.minimumConstraints.riskFloor,
      minimumApprovalThreshold: version.terms.minimumConstraints.minimumApprovalThreshold,
      minimumTimelockSeconds: version.terms.minimumConstraints.minimumTimelockSeconds,
      operatorPolicy: selectedPurpose?.operatorPolicy ? {
        maximumDurationSeconds: selectedPurpose.operatorPolicy.limits.maximumDurationSeconds,
        frequency: { ...selectedPurpose.operatorPolicy.limits.frequency },
        appeal: { ...selectedPurpose.operatorPolicy.limits.appeal },
        targetScope: selectedPurpose.operatorPolicy.limits.targetScope,
      } : null,
      reauthorization: selectedPurpose?.operatorPolicy?.reauthorization ?? null,
      executionAuthority: selectedPurpose?.operatorPolicy ? {
        ...selectedPurpose.operatorPolicy.executionAuthorityRequirement,
        ref: selectedPurpose.operatorPolicy.executionAuthorityRequirement.adapter,
      } : null,
      termination: selectedPurpose?.operatorPolicy?.termination ?? null,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveUntil: effectiveUntil.toISOString(),
    },
    authorityEffectiveFrom: effectiveFrom,
    authorityEffectiveUntil: effectiveUntil,
  };
}

function actionSelectorMatches(
  selector: { actionType: string | null; actionPrefix: string | null },
  actionType: string,
): boolean {
  return selector.actionType === actionType
    || Boolean(selector.actionPrefix && (
      actionType === selector.actionPrefix
      || actionType.startsWith(`${selector.actionPrefix}.`)
    ));
}

export function assertGovernanceMandateProjectionMatch(
  binding: CircleGovernanceBindingRecord,
  mandate: GovernanceMandateRecord,
  version: GovernanceMandateVersionRecord,
): void {
  assertGovernanceMandateVersionMatch(binding, mandate, version, true);
}

function assertGovernanceMandateVersionMatch(
  binding: CircleGovernanceBindingRecord,
  mandate: GovernanceMandateRecord,
  version: GovernanceMandateVersionRecord,
  requireCurrentProjection: boolean,
): void {
  const terms = version.terms;
  const exact = Boolean(
    binding.mandateId
    && binding.mandateId === mandate.id
    && binding.bindingType === "shared_committee"
    && mandate.bindingType === "shared_committee"
    && mandate.delegatorGovernanceHomeType === "circle"
    && mandate.delegatorGovernanceHomeRef === String(binding.targetCircleId)
    && mandate.delegateAuthorityType === "circle_governance_committee"
    && mandate.delegateAuthorityRef === String(binding.committeeCircleId)
    && (!requireCurrentProjection || mandate.currentVersion === version.version)
    && (!requireCurrentProjection || mandate.currentTermsDigest === version.termsDigest)
    && computeGovernanceMandateTermsDigest(terms) === version.termsDigest
    && terms.schemaVersion === 1
    && Array.isArray(terms.purposeBindings)
    && terms.purposeBindings.length > 0
    && terms.purposeBindings.every((binding) =>
      binding.purpose === "collective_decision"
      || binding.purpose === "operational_execution"
    )
    && isGovernanceMandateOperatorPolicyValid(terms)
    && terms.environment === "local_development"
    && (terms.network === "solana:localnet" || terms.network === "solana:devnet")
    && terms.delegatorGovernanceHome.type === mandate.delegatorGovernanceHomeType
    && terms.delegatorGovernanceHome.ref === mandate.delegatorGovernanceHomeRef
    && terms.delegateAuthority.type === mandate.delegateAuthorityType
    && terms.delegateAuthority.ref === mandate.delegateAuthorityRef
    && terms.subject.type.length > 0
    && terms.subject.ref.length > 0
    && normalizeGovernanceMandateMinimumConstraints(terms.minimumConstraints).riskFloor
      === terms.minimumConstraints.riskFloor
    && hashCanonicalGovernanceValue(
      'alcheme.governance.mandate-purpose-bindings',
      version.purposeBindings,
    ) === hashCanonicalGovernanceValue(
      'alcheme.governance.mandate-purpose-bindings',
      terms.purposeBindings,
    )
    && version.environment === terms.environment
    && version.network === terms.network
    && version.subjectType === terms.subject.type
    && version.subjectRef === terms.subject.ref
    && (version.actionType ?? null) === terms.actionSelector.actionType
    && (version.actionPrefix ?? null) === terms.actionSelector.actionPrefix
    && (!requireCurrentProjection || (binding.actionType ?? null) === terms.actionSelector.actionType)
    && (!requireCurrentProjection || (binding.actionPrefix ?? null) === terms.actionSelector.actionPrefix)
    && new Date(version.effectiveFrom).toISOString() === terms.effectiveFrom
    && new Date(version.effectiveUntil).toISOString() === terms.effectiveUntil
  );
  if (!exact) throw new Error("governance_mandate_binding_shadow_mismatch");
}

function bindingScopeOverlaps(
  binding: Pick<
    CircleGovernanceBindingRecord,
    | "actionType"
    | "actionPrefix"
    | "status"
    | "targetAuthorizationStatus"
    | "committeeMandateStatus"
  >,
  candidate: {
    actionType?: string | null;
    actionPrefix?: string | null;
  },
): boolean {
  const reservesScope = binding.status === "active"
    ? binding.targetAuthorizationStatus === "accepted"
      && binding.committeeMandateStatus === "accepted"
    : binding.status === "pending_mandate"
      && ["pending", "accepted"].includes(binding.targetAuthorizationStatus)
      && ["pending", "accepted"].includes(binding.committeeMandateStatus);
  if (!reservesScope) {
    return false;
  }

  const existingType = normalizeOptionalString(binding.actionType);
  const existingPrefix = normalizeOptionalString(binding.actionPrefix);
  const candidateType = normalizeOptionalString(candidate.actionType);
  const candidatePrefix = normalizeOptionalString(candidate.actionPrefix);

  if (existingType && candidateType) return existingType === candidateType;
  if (existingType && candidatePrefix) {
    return actionMatchesPrefix(existingType, candidatePrefix);
  }
  if (existingPrefix && candidateType) {
    return actionMatchesPrefix(candidateType, existingPrefix);
  }
  if (existingPrefix && candidatePrefix) {
    return (
      actionMatchesPrefix(existingPrefix, candidatePrefix) ||
      actionMatchesPrefix(candidatePrefix, existingPrefix)
    );
  }
  return false;
}

function assertCommitteePolicyMeetsMandateMinimum(
  electorateTemplate: CircleGovernanceCommitteeElectorateTemplate,
  eligibleActorCount: number,
  minimum: GovernanceMandateMinimumConstraints,
): void {
  const configuredThreshold = electorateTemplate.threshold.mode === 'unanimity'
    ? eligibleActorCount
    : electorateTemplate.threshold.mode === 'fixed_count'
      ? Number(electorateTemplate.threshold.value)
      : Math.floor(eligibleActorCount / 2) + 1;
  if (
    !Number.isSafeInteger(configuredThreshold)
    || configuredThreshold <= 0
    || configuredThreshold < minimum.minimumApprovalThreshold
  ) {
    throw new Error('governance_mandate_minimum_quorum_not_met');
  }
}

function actionMatchesPrefix(actionType: string, actionPrefix: string): boolean {
  return actionType === actionPrefix || actionType.startsWith(`${actionPrefix}.`);
}

function assertOrdinaryCircleGovernanceCommitteeEligibility(
  binding: Pick<
    CircleGovernanceBindingRecord,
    "bindingType" | "targetCircleId" | "committeeCircleId"
  >,
  circle: CircleGovernanceCommitteeCircle,
): void {
  if (circle.lifecycleStatus && circle.lifecycleStatus !== "Active") {
    throw new Error("circle_governance_committee_not_active");
  }
  if (binding.targetCircleId === binding.committeeCircleId) {
    if (binding.bindingType !== "self_governed") {
      throw new Error("circle_governance_self_governance_must_be_explicit");
    }
    return;
  }
  if (
    binding.bindingType === "local_auxiliary" &&
    circle.parentCircleId !== binding.targetCircleId
  ) {
    throw new Error("local_auxiliary_committee_must_be_target_child");
  }
}

function normalizeActionScope(input: {
  actionType?: string | null;
  actionPrefix?: string | null;
}): string {
  const actionType = String(input.actionType ?? "").trim();
  const actionPrefix = String(input.actionPrefix ?? "").trim();
  if (actionType && actionPrefix) {
    throw new Error("circle_governance_binding_scope_ambiguous");
  }
  if (actionType) return actionType;
  if (actionPrefix) return actionPrefix;
  throw new Error("circle_governance_binding_scope_required");
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function digestJson(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(stableJsonStringify(value))
    .digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
