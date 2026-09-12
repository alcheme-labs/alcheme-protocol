import {
  GOVERNANCE_CANONICAL_CODEC_VERSION,
  canonicalGovernanceJson,
  hashCanonicalGovernanceValue,
} from "./canonicalCodec";

export const GOVERNANCE_BOOTSTRAP_BUNDLE_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_BUNDLE_DOMAIN =
  "alcheme.governance.bootstrap-bundle" as const;

export interface GovernanceBootstrapVersionedRef {
  ref: string;
  version: string;
  digest: string;
}

export interface GovernanceBootstrapPolicyDimension {
  applicability: "applicable" | "not_applicable";
  policy: GovernanceBootstrapVersionedRef | null;
}

export interface GovernanceBootstrapBundleInput {
  homeIdentity: {
    ref: string;
    version: number;
    digest: string;
  };
  template: GovernanceBootstrapVersionedRef;
  policyDimensions: {
    admission: GovernanceBootstrapPolicyDimension;
    proposalCreation: GovernanceBootstrapPolicyDimension;
    voterEligibility: GovernanceBootstrapPolicyDimension;
    votingPower: GovernanceBootstrapPolicyDimension;
  };
  riskFloor: {
    value: "low" | "medium" | "high" | "critical";
    source: GovernanceBootstrapVersionedRef;
  };
  stagePlan: GovernanceBootstrapVersionedRef;
  visibilityPolicy: GovernanceBootstrapVersionedRef;
  emergencyPolicy: GovernanceBootstrapVersionedRef;
  payerPolicy: GovernanceBootstrapVersionedRef;
  initialAuthorityPolicy: GovernanceBootstrapVersionedRef;
  mandateRefs: GovernanceBootstrapVersionedRef[];
  providerRefs: GovernanceBootstrapVersionedRef[];
  resourceRefs: GovernanceBootstrapVersionedRef[];
}

export interface GovernanceBootstrapBundle
  extends GovernanceBootstrapBundleInput {
  schemaVersion: typeof GOVERNANCE_BOOTSTRAP_BUNDLE_SCHEMA_VERSION;
  canonicalCodecVersion: typeof GOVERNANCE_CANONICAL_CODEC_VERSION;
}

export type GovernanceBootstrapReadinessStatus =
  | "ready"
  | "blocked"
  | "unknown"
  | "not_applicable";

export interface GovernanceBootstrapReadinessFact {
  status: GovernanceBootstrapReadinessStatus;
  evidenceRef: string | null;
  evidenceDigest: string | null;
  bundleDigest: string | null;
  reasonCode: string | null;
}

export interface GovernanceBootstrapReadinessChecks {
  eligibleActors: GovernanceBootstrapReadinessFact;
  threshold: GovernanceBootstrapReadinessFact;
  authority: GovernanceBootstrapReadinessFact;
  funding: GovernanceBootstrapReadinessFact;
  publicSafeBoundary: GovernanceBootstrapReadinessFact;
  recoveryContact: GovernanceBootstrapReadinessFact;
  mandates: GovernanceBootstrapReadinessFact;
  providers: GovernanceBootstrapReadinessFact;
  resources: GovernanceBootstrapReadinessFact;
}

export interface GovernanceBootstrapReadinessBlocker {
  fact: keyof GovernanceBootstrapReadinessChecks;
  status: GovernanceBootstrapReadinessStatus;
  code: string;
}

const READINESS_FACT_CODE: Record<keyof GovernanceBootstrapReadinessChecks, string> = {
  eligibleActors: "eligible_actors",
  threshold: "threshold",
  authority: "authority",
  funding: "funding",
  publicSafeBoundary: "public_safe_boundary",
  recoveryContact: "recovery_contact",
  mandates: "mandates",
  providers: "providers",
  resources: "resources",
};

const REQUIRED_READINESS_FACTS: Array<keyof GovernanceBootstrapReadinessChecks> = [
  "eligibleActors",
  "threshold",
  "authority",
  "funding",
  "publicSafeBoundary",
  "recoveryContact",
];

const OPTIONAL_READINESS_FACT_REFS: Record<
  "mandates" | "providers" | "resources",
  "mandateRefs" | "providerRefs" | "resourceRefs"
> = {
  mandates: "mandateRefs",
  providers: "providerRefs",
  resources: "resourceRefs",
};

const BOOTSTRAP_BUNDLE_INPUT_FIELDS = new Set([
  "homeIdentity",
  "template",
  "policyDimensions",
  "riskFloor",
  "stagePlan",
  "visibilityPolicy",
  "emergencyPolicy",
  "payerPolicy",
  "initialAuthorityPolicy",
  "mandateRefs",
  "providerRefs",
  "resourceRefs",
]);
const VERSIONED_REF_FIELDS = new Set(["ref", "version", "digest"]);
const HOME_IDENTITY_FIELDS = new Set(["ref", "version", "digest"]);
const RISK_FLOOR_FIELDS = new Set(["value", "source"]);
const POLICY_DIMENSION_VALUE_FIELDS = new Set(["applicability", "policy"]);
const POLICY_DIMENSION_FIELDS = new Set([
  "admission",
  "proposalCreation",
  "voterEligibility",
  "votingPower",
]);
const READINESS_FACT_FIELDS = new Set([
  "status",
  "evidenceRef",
  "evidenceDigest",
  "bundleDigest",
  "reasonCode",
]);

export function createGovernanceBootstrapBundle(
  input: GovernanceBootstrapBundleInput,
): {
  bundle: GovernanceBootstrapBundle;
  canonicalJson: string;
  digest: string;
} {
  if (Object.keys(input).some((key) => !BOOTSTRAP_BUNDLE_INPUT_FIELDS.has(key))) {
    throw new Error("unsupported_governance_bootstrap_bundle_field");
  }
  if (Object.keys(input).length !== BOOTSTRAP_BUNDLE_INPUT_FIELDS.size) {
    throw new Error("governance_bootstrap_bundle_fields_required");
  }
  if (
    hasUnsupportedField(input.homeIdentity, HOME_IDENTITY_FIELDS)
    || hasUnsupportedField(input.riskFloor, RISK_FLOOR_FIELDS)
    || Object.values(input.policyDimensions).some((dimension) =>
      hasUnsupportedField(dimension, POLICY_DIMENSION_VALUE_FIELDS)
    )
  ) {
    throw new Error("unsupported_governance_bootstrap_structural_field");
  }
  if (
    Object.keys(input.policyDimensions)
      .some((key) => !POLICY_DIMENSION_FIELDS.has(key))
  ) {
    throw new Error("unsupported_governance_bootstrap_policy_dimension");
  }
  if (Object.keys(input.policyDimensions).length !== POLICY_DIMENSION_FIELDS.size) {
    throw new Error("governance_bootstrap_policy_dimensions_required");
  }
  if (
    input.riskFloor.value !== "low"
    && input.riskFloor.value !== "medium"
    && input.riskFloor.value !== "high"
    && input.riskFloor.value !== "critical"
  ) {
    throw new Error("invalid_governance_bootstrap_risk_floor");
  }
  if (
    !Number.isSafeInteger(input.homeIdentity.version)
    || input.homeIdentity.version < 1
  ) {
    throw new Error("invalid_governance_bootstrap_home_identity_version");
  }
  if (!input.homeIdentity.ref.trim()) {
    throw new Error("governance_bootstrap_home_identity_ref_required");
  }
  for (const dimension of Object.values(input.policyDimensions)) {
    if (
      dimension.applicability !== "applicable"
      && dimension.applicability !== "not_applicable"
    ) {
      throw new Error("invalid_governance_bootstrap_policy_applicability");
    }
    if (dimension.applicability === "applicable" && !dimension.policy) {
      throw new Error("governance_bootstrap_applicable_policy_required");
    }
    if (dimension.applicability === "not_applicable" && dimension.policy) {
      throw new Error("governance_bootstrap_not_applicable_policy_must_be_null");
    }
  }
  for (const ref of listVersionedRefs(input)) {
    if (Object.keys(ref).some((key) => !VERSIONED_REF_FIELDS.has(key))) {
      throw new Error("unsupported_governance_bootstrap_fact_field");
    }
    if (!ref.ref.trim()) {
      throw new Error("governance_bootstrap_fact_ref_required");
    }
    if (!ref.version.trim()) {
      throw new Error("governance_bootstrap_fact_version_required");
    }
    if (ref.ref !== ref.ref.trim() || ref.version !== ref.version.trim()) {
      throw new Error("non_canonical_governance_bootstrap_fact");
    }
    if (!/^[a-f0-9]{64}$/.test(ref.digest)) {
      throw new Error("invalid_governance_bootstrap_fact_digest");
    }
  }
  if (!/^[a-f0-9]{64}$/.test(input.homeIdentity.digest)) {
    throw new Error("invalid_governance_bootstrap_fact_digest");
  }
  const bundle = deepFreeze<GovernanceBootstrapBundle>({
    schemaVersion: GOVERNANCE_BOOTSTRAP_BUNDLE_SCHEMA_VERSION,
    canonicalCodecVersion: GOVERNANCE_CANONICAL_CODEC_VERSION,
    homeIdentity: { ...input.homeIdentity },
    template: cloneVersionedRef(input.template),
    policyDimensions: {
      admission: clonePolicyDimension(input.policyDimensions.admission),
      proposalCreation: clonePolicyDimension(input.policyDimensions.proposalCreation),
      voterEligibility: clonePolicyDimension(input.policyDimensions.voterEligibility),
      votingPower: clonePolicyDimension(input.policyDimensions.votingPower),
    },
    riskFloor: {
      value: input.riskFloor.value,
      source: cloneVersionedRef(input.riskFloor.source),
    },
    stagePlan: cloneVersionedRef(input.stagePlan),
    visibilityPolicy: cloneVersionedRef(input.visibilityPolicy),
    emergencyPolicy: cloneVersionedRef(input.emergencyPolicy),
    payerPolicy: cloneVersionedRef(input.payerPolicy),
    initialAuthorityPolicy: cloneVersionedRef(input.initialAuthorityPolicy),
    mandateRefs: sortVersionedRefs(input.mandateRefs),
    providerRefs: sortVersionedRefs(input.providerRefs),
    resourceRefs: sortVersionedRefs(input.resourceRefs),
  });
  return {
    bundle,
    canonicalJson: canonicalGovernanceJson(
      GOVERNANCE_BOOTSTRAP_BUNDLE_DOMAIN,
      bundle,
    ),
    digest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_BUNDLE_DOMAIN,
      bundle,
    ),
  };
}

export function evaluateGovernanceBootstrapReadiness(input: {
  bundle: GovernanceBootstrapBundleInput;
  checks: GovernanceBootstrapReadinessChecks;
}): {
  state: "ready" | "blocked";
  bundleDigest: string;
  blockers: GovernanceBootstrapReadinessBlocker[];
} {
  const bundleDigest = createGovernanceBootstrapBundle(input.bundle).digest;
  if (
    Object.keys(input.checks)
      .some((key) => !(key in READINESS_FACT_CODE))
  ) {
    throw new Error("unsupported_governance_bootstrap_readiness_check");
  }
  if (Object.keys(input.checks).length !== Object.keys(READINESS_FACT_CODE).length) {
    throw new Error("governance_bootstrap_readiness_checks_required");
  }
  for (const readiness of Object.values(input.checks)) {
    if (hasUnsupportedField(readiness, READINESS_FACT_FIELDS)) {
      throw new Error("unsupported_governance_bootstrap_readiness_fact_field");
    }
    if (
      readiness.status !== "ready"
      && readiness.status !== "blocked"
      && readiness.status !== "unknown"
      && readiness.status !== "not_applicable"
    ) {
      throw new Error("invalid_governance_bootstrap_readiness_status");
    }
  }
  const blockers: GovernanceBootstrapReadinessBlocker[] = [];
  for (const fact of REQUIRED_READINESS_FACTS) {
    const readiness = input.checks[fact];
    if (readiness.status === "ready") {
      const evidenceBlocker = readyEvidenceBlocker(fact, readiness, bundleDigest);
      if (evidenceBlocker) blockers.push(evidenceBlocker);
    } else {
      blockers.push({
        fact,
        status: readiness.status,
        code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_${readiness.status}`,
      });
    }
  }
  for (const [fact, refsKey] of Object.entries(OPTIONAL_READINESS_FACT_REFS) as Array<
    [keyof typeof OPTIONAL_READINESS_FACT_REFS, "mandateRefs" | "providerRefs" | "resourceRefs"]
  >) {
    const readiness = input.checks[fact];
    if (
      input.bundle[refsKey].length === 0
      && readiness.status !== "not_applicable"
    ) {
      blockers.push({
        fact,
        status: readiness.status,
        code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_must_be_not_applicable`,
      });
    } else if (
      input.bundle[refsKey].length === 0
      && readiness.status === "not_applicable"
      && (
        readiness.evidenceRef !== null
        || readiness.evidenceDigest !== null
        || readiness.bundleDigest !== null
      )
    ) {
      blockers.push({
        fact,
        status: readiness.status,
        code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_not_applicable_evidence_must_be_null`,
      });
    } else if (
      input.bundle[refsKey].length > 0
      && readiness.status !== "ready"
    ) {
      blockers.push({
        fact,
        status: readiness.status,
        code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_${readiness.status}`,
      });
    } else if (input.bundle[refsKey].length > 0) {
      const evidenceBlocker = readyEvidenceBlocker(fact, readiness, bundleDigest);
      if (evidenceBlocker) blockers.push(evidenceBlocker);
    }
  }
  return {
    state: blockers.length === 0 ? "ready" : "blocked",
    bundleDigest,
    blockers,
  };
}

function readyEvidenceBlocker(
  fact: keyof GovernanceBootstrapReadinessChecks,
  readiness: GovernanceBootstrapReadinessFact,
  bundleDigest: string,
): GovernanceBootstrapReadinessBlocker | null {
  if (!readiness.evidenceRef?.trim() || !readiness.evidenceDigest) {
    return {
      fact,
      status: readiness.status,
      code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_evidence_missing`,
    };
  }
  if (!/^[a-f0-9]{64}$/.test(readiness.evidenceDigest)) {
    return {
      fact,
      status: readiness.status,
      code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_evidence_invalid`,
    };
  }
  if (!readiness.bundleDigest) {
    return {
      fact,
      status: readiness.status,
      code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_evidence_bundle_missing`,
    };
  }
  if (readiness.bundleDigest !== bundleDigest) {
    return {
      fact,
      status: readiness.status,
      code: `governance_bootstrap_${READINESS_FACT_CODE[fact]}_evidence_bundle_mismatch`,
    };
  }
  return null;
}

function hasUnsupportedField(
  value: object,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

function cloneVersionedRef(
  value: GovernanceBootstrapVersionedRef,
): GovernanceBootstrapVersionedRef {
  return { ref: value.ref, version: value.version, digest: value.digest };
}

function clonePolicyDimension(
  value: GovernanceBootstrapPolicyDimension,
): GovernanceBootstrapPolicyDimension {
  return {
    applicability: value.applicability,
    policy: value.policy ? cloneVersionedRef(value.policy) : null,
  };
}

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

function listVersionedRefs(
  input: GovernanceBootstrapBundleInput,
): GovernanceBootstrapVersionedRef[] {
  const policyRefs = Object.values(input.policyDimensions)
    .map((dimension) => dimension.policy)
    .filter((value): value is GovernanceBootstrapVersionedRef => value !== null);
  return [
    input.template,
    ...policyRefs,
    input.riskFloor.source,
    input.stagePlan,
    input.visibilityPolicy,
    input.emergencyPolicy,
    input.payerPolicy,
    ...input.mandateRefs,
    ...input.providerRefs,
    ...input.resourceRefs,
  ];
}

function sortVersionedRefs(
  values: GovernanceBootstrapVersionedRef[],
): GovernanceBootstrapVersionedRef[] {
  const sorted = values.map(cloneVersionedRef).sort((left, right) => {
    const leftKey = `${left.ref}\u0000${left.version}\u0000${left.digest}`;
    const rightKey = `${right.ref}\u0000${right.version}\u0000${right.digest}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (let index = 1; index < sorted.length; index += 1) {
    if (
      sorted[index - 1].ref === sorted[index].ref
      && sorted[index - 1].version === sorted[index].version
      && sorted[index - 1].digest === sorted[index].digest
    ) {
      throw new Error("duplicate_governance_bootstrap_fact_ref");
    }
  }
  return sorted;
}
