import { hashCanonicalGovernanceValue } from './canonicalCodec';

export type GovernanceProfileDimension =
  | 'admission'
  | 'proposal_creation'
  | 'voter_eligibility'
  | 'voting_power';

export interface GovernanceProfileDefinition {
  profileId: string;
  version: number;
  versionRef: string;
  definitionDigest: string;
  supportedHomeTypes: readonly string[];
  identitySource: Readonly<Record<string, unknown>>;
  membershipSource: Readonly<Record<string, unknown>>;
  dimensionApplicability: Readonly<Record<GovernanceProfileDimension, Readonly<{
    status: 'applicable' | 'not_applicable';
    reason: string;
    providerMapping: string;
  }>>>;
  actionCatalog: readonly string[];
  authorityCapabilities: readonly string[];
  providerCapabilities: readonly string[];
  adapterCapabilities: readonly string[];
  uiSchemaMetadata: Readonly<{ schemaId: string; labelKey: string }>;
}

export const ALCHEME_GOVERNANCE_UI_SCHEMA_REGISTRY = deepFreeze({
  'alcheme-governance-workspace-v1': {
    owner: 'alcheme',
    responsive: true,
    surfaces: ['circle_detail', 'circle_settings_sheet'],
  },
} as const);

type GovernanceProfileDefinitionInput = Omit<GovernanceProfileDefinition,
  'versionRef' | 'definitionDigest'>;

export function createGovernanceProfileDefinition(
  input: GovernanceProfileDefinitionInput,
): GovernanceProfileDefinition {
  assertProfileDefinitionInputKeys(input as unknown as Record<string, unknown>);
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(input.profileId) || !Number.isInteger(input.version) || input.version <= 0) {
    throw new Error('governance_profile_identity_invalid');
  }
  if (input.supportedHomeTypes.length === 0 || input.actionCatalog.length === 0
    || input.adapterCapabilities.length === 0 || !input.uiSchemaMetadata.schemaId.trim()
    || !input.uiSchemaMetadata.labelKey.trim()) {
    throw new Error('governance_profile_capability_manifest_incomplete');
  }
  const dimensions: GovernanceProfileDimension[] = [
    'admission', 'proposal_creation', 'voter_eligibility', 'voting_power',
  ];
  for (const dimension of dimensions) {
    const value = input.dimensionApplicability[dimension];
    if (!value || !value.reason.trim() || !value.providerMapping.trim()) {
      throw new Error('governance_profile_dimension_applicability_incomplete');
    }
  }
  assertGovernanceProfileMetadataBoundary(input);
  const frozen = JSON.parse(JSON.stringify({
    profileId: input.profileId,
    version: input.version,
    supportedHomeTypes: input.supportedHomeTypes,
    identitySource: input.identitySource,
    membershipSource: input.membershipSource,
    dimensionApplicability: input.dimensionApplicability,
    actionCatalog: input.actionCatalog,
    authorityCapabilities: input.authorityCapabilities,
    providerCapabilities: input.providerCapabilities,
    adapterCapabilities: input.adapterCapabilities,
    uiSchemaMetadata: input.uiSchemaMetadata,
  })) as GovernanceProfileDefinitionInput;
  const definitionDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.profile-definition', frozen,
  );
  return deepFreeze({
    ...frozen,
    versionRef: `${input.profileId}@${input.version}:${definitionDigest.slice(0, 16)}`,
    definitionDigest,
  }) as GovernanceProfileDefinition;
}

export function assertGovernanceProfileDefinitionBoundary(
  profile: GovernanceProfileDefinition,
): GovernanceProfileDefinition {
  assertProfileDefinitionInputKeys(profile as unknown as Record<string, unknown>);
  assertGovernanceProfileMetadataBoundary(profile);
  assertProfileDefinitionIntegrity(profile);
  return profile;
}

export function assertGovernanceProfileSupportsAction(
  profile: GovernanceProfileDefinition,
  input: { homeType: string; actionType: string; executionAdapter: string },
): GovernanceProfileDefinition {
  assertGovernanceProfileDefinitionBoundary(profile);
  const actionSupported = profile.actionCatalog.some((entry) =>
    entry === input.actionType || governanceActionNamespaceMatches(entry, input.actionType));
  if (!profile.supportedHomeTypes.includes(input.homeType)
    || !actionSupported
    || !profile.adapterCapabilities.includes(input.executionAdapter)) {
    throw new Error('governance_profile_action_capability_mismatch');
  }
  return profile;
}

function governanceActionNamespaceMatches(entry: string, actionType: string): boolean {
  if (!entry.endsWith('.*')) return false;
  const namespace = entry.slice(0, -2);
  return actionType.startsWith(namespace + '.') || actionType.startsWith(namespace + '_');
}

export type GovernanceProfileTransitionOperation = 'bind' | 'upgrade' | 'rollback';

export interface GovernanceProfileTransitionArtifact {
  operation: GovernanceProfileTransitionOperation;
  homeIdentityBindingId: string;
  currentProfileVersionRef: string | null;
  targetProfileVersionRef: string;
  targetProfileDefinitionDigest: string;
  reasonCode: string;
  transitionDigest: string;
}

export function createGovernanceProfileTransition(input: {
  operation: GovernanceProfileTransitionOperation;
  homeIdentityBindingId: string;
  currentProfileVersionRef: string | null;
  targetProfile: GovernanceProfileDefinition;
  reasonCode: string;
}): GovernanceProfileTransitionArtifact {
  assertExactKeys(input as unknown as Record<string, unknown>, [
    'operation', 'homeIdentityBindingId', 'currentProfileVersionRef', 'targetProfile', 'reasonCode',
  ]);
  if (containsIdentityMutationField(input.targetProfile)) {
    throw new Error('governance_profile_transition_identity_mutation_forbidden');
  }
  assertGovernanceProfileDefinitionBoundary(input.targetProfile);
  const facts = {
    operation: input.operation,
    homeIdentityBindingId: input.homeIdentityBindingId,
    currentProfileVersionRef: input.currentProfileVersionRef,
    targetProfileVersionRef: input.targetProfile.versionRef,
    targetProfileDefinitionDigest: input.targetProfile.definitionDigest,
    reasonCode: input.reasonCode,
  };
  return deepFreeze(assertGovernanceProfileTransitionPayload(
    `governance.profile.${input.operation}`,
    {
      ...facts,
      transitionDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.profile-transition', facts,
      ),
    },
  ));
}

export function assertGovernanceProfileTransitionPayload(
  actionType: string,
  payload: Record<string, unknown>,
): GovernanceProfileTransitionArtifact {
  if (containsIdentityMutationField(payload)) {
    throw new Error('governance_profile_transition_identity_mutation_forbidden');
  }
  assertExactKeys(payload, [
    'operation', 'homeIdentityBindingId', 'currentProfileVersionRef',
    'targetProfileVersionRef', 'targetProfileDefinitionDigest', 'reasonCode', 'transitionDigest',
  ]);
  const expectedOperation = actionType.startsWith('governance.profile.')
    ? actionType.slice('governance.profile.'.length)
    : '';
  const operation = payload.operation;
  const currentProfileVersionRef = payload.currentProfileVersionRef;
  if (!['bind', 'upgrade', 'rollback'].includes(String(operation))
    || operation !== expectedOperation
    || typeof payload.homeIdentityBindingId !== 'string'
    || !payload.homeIdentityBindingId.trim()
    || typeof payload.targetProfileVersionRef !== 'string'
    || !payload.targetProfileVersionRef.trim()
    || typeof payload.targetProfileDefinitionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.targetProfileDefinitionDigest)
    || typeof payload.reasonCode !== 'string'
    || !payload.reasonCode.trim()
    || payload.reasonCode !== payload.reasonCode.trim()
    || payload.reasonCode.length > 128
    || (operation === 'bind' && currentProfileVersionRef !== null)
    || (operation !== 'bind' && (typeof currentProfileVersionRef !== 'string'
      || !currentProfileVersionRef.trim()))
    || currentProfileVersionRef === payload.targetProfileVersionRef) {
    throw new Error('governance_profile_transition_payload_invalid');
  }
  const facts = {
    operation,
    homeIdentityBindingId: payload.homeIdentityBindingId,
    currentProfileVersionRef,
    targetProfileVersionRef: payload.targetProfileVersionRef,
    targetProfileDefinitionDigest: payload.targetProfileDefinitionDigest,
    reasonCode: payload.reasonCode,
  };
  if (payload.transitionDigest !== hashCanonicalGovernanceValue(
    'alcheme.governance.profile-transition', facts,
  )) {
    throw new Error('governance_profile_transition_digest_mismatch');
  }
  return payload as unknown as GovernanceProfileTransitionArtifact;
}

export function assertGovernanceProfileTransitionEnvelopePayload(
  actionType: string,
  payload: Record<string, unknown>,
): GovernanceProfileTransitionArtifact {
  const { evidencePolicy: _evidencePolicy, ...transitionPayload } = payload;
  return assertGovernanceProfileTransitionPayload(actionType, transitionPayload);
}

function assertProfileDefinitionIntegrity(profile: GovernanceProfileDefinition): void {
  const {
    versionRef: _versionRef,
    definitionDigest: _definitionDigest,
    ...definition
  } = profile;
  const digest = hashCanonicalGovernanceValue('alcheme.governance.profile-definition', definition);
  if (profile.definitionDigest !== digest
    || profile.versionRef !== `${profile.profileId}@${profile.version}:${digest.slice(0, 16)}`) {
    throw new Error('governance_profile_definition_integrity_mismatch');
  }
}

function assertProfileDefinitionInputKeys(value: Record<string, unknown>): void {
  assertMetadataExactKeys(value, [
    'profileId', 'version', 'supportedHomeTypes', 'identitySource', 'membershipSource',
    'dimensionApplicability', 'actionCatalog', 'authorityCapabilities', 'providerCapabilities',
    'adapterCapabilities', 'uiSchemaMetadata', 'versionRef', 'definitionDigest',
  ], [
    'profileId', 'version', 'supportedHomeTypes', 'identitySource', 'membershipSource',
    'dimensionApplicability', 'actionCatalog', 'authorityCapabilities', 'providerCapabilities',
    'adapterCapabilities', 'uiSchemaMetadata',
  ]);
}

function assertGovernanceProfileMetadataBoundary(
  profile: GovernanceProfileDefinitionInput | GovernanceProfileDefinition,
): void {
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(profile.profileId)
    || !Number.isInteger(profile.version) || profile.version <= 0) {
    throw new Error('governance_profile_metadata_boundary_invalid');
  }
  assertMetadataRecord(profile.identitySource, ['type', 'projection'], ['type']);
  assertMetadataRecord(
    profile.membershipSource, ['type', 'projection', 'roleSchema', 'reason'], ['type'],
  );
  assertMetadataExactKeys(profile.dimensionApplicability as unknown as Record<string, unknown>, [
    'admission', 'proposal_creation', 'voter_eligibility', 'voting_power',
  ]);
  for (const value of Object.values(profile.dimensionApplicability)) {
    assertMetadataRecord(
      value as unknown as Readonly<Record<string, unknown>>,
      ['status', 'reason', 'providerMapping'], ['status', 'reason', 'providerMapping'],
    );
    if (!['applicable', 'not_applicable'].includes(value.status)) {
      throw new Error('governance_profile_metadata_boundary_invalid');
    }
  }
  assertMetadataExactKeys(profile.uiSchemaMetadata as unknown as Record<string, unknown>, [
    'schemaId', 'labelKey',
  ]);
  if (typeof profile.uiSchemaMetadata.schemaId !== 'string'
    || !(profile.uiSchemaMetadata.schemaId in ALCHEME_GOVERNANCE_UI_SCHEMA_REGISTRY)) {
    throw new Error('governance_profile_ui_schema_not_alcheme_owned');
  }
  if (typeof profile.uiSchemaMetadata.labelKey !== 'string'
    || !/^governance\.profile\.[a-z0-9._-]{1,96}$/.test(profile.uiSchemaMetadata.labelKey)) {
    throw new Error('governance_profile_metadata_boundary_invalid');
  }
  assertMetadataTokenList(profile.supportedHomeTypes);
  assertMetadataTokenList(profile.actionCatalog);
  assertMetadataTokenList(profile.authorityCapabilities);
  assertMetadataTokenList(profile.providerCapabilities);
  assertMetadataTokenList(profile.adapterCapabilities);
}

function assertMetadataRecord(
  value: Readonly<Record<string, unknown>>,
  allowed: string[],
  required: string[],
): void {
  assertMetadataExactKeys(value as Record<string, unknown>, allowed, required);
  for (const nested of Object.values(value)) {
    if (typeof nested !== 'string' || !/^[a-z][a-z0-9:._-]{0,127}$/.test(nested)) {
      throw new Error('governance_profile_metadata_boundary_invalid');
    }
  }
}

function assertMetadataTokenList(value: readonly string[]): void {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
    || value.some((item) => typeof item !== 'string'
      || !/^[a-z][a-z0-9:.*_-]{0,127}$/.test(item))) {
    throw new Error('governance_profile_metadata_boundary_invalid');
  }
}

function assertMetadataExactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  required: string[] = allowed,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('governance_profile_metadata_boundary_invalid');
  }
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))
    || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error('governance_profile_metadata_boundary_invalid');
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('governance_profile_transition_payload_invalid');
  }
}

function containsIdentityMutationField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsIdentityMutationField);
  const forbidden = new Set([
    'canonicalOrganizationRef', 'controllingAuthorityRef', 'externalNetwork',
    'verificationDigest', 'verifiedAt', 'verificationExpiresAt',
  ]);
  return Object.entries(value as Record<string, unknown>)
    .some(([key, nested]) => forbidden.has(key) || containsIdentityMutationField(nested));
}

export const CIRCLE_GOVERNANCE_PROFILE_V1 = createGovernanceProfileDefinition({
  profileId: 'alcheme.circle.native',
  version: 1,
  supportedHomeTypes: ['circle'],
  identitySource: { type: 'governance_home_identity_binding', projection: 'circle' },
  membershipSource: { type: 'circle_membership', roleSchema: 'circle-member-role-v1' },
  dimensionApplicability: {
    admission: { status: 'applicable', reason: 'circle_has_membership', providerMapping: 'circle_membership' },
    proposal_creation: { status: 'applicable', reason: 'circle_policy', providerMapping: 'governance_policy' },
    voter_eligibility: { status: 'applicable', reason: 'frozen_circle_electorate', providerMapping: 'governance_snapshot' },
    voting_power: { status: 'applicable', reason: 'policy_strategy', providerMapping: 'governance_snapshot' },
  },
  actionCatalog: [
    'circle.*', 'governance.*', 'communication.*', 'operator.capability.suspend', 'draft.*', 'external_app.*',
    'revision_direction.*', 'room.*', 'source_material.*', 'temporary_edit_grant.*',
    'treasury.*', 'grant.*',
  ],
  authorityCapabilities: ['policy_binding', 'mandate_projection', 'registered_adapter'],
  providerCapabilities: ['internal', 'solana:localnet'],
  adapterCapabilities: [
    'circle_agent', 'circle_authority', 'circle_committee_profile', 'circle_governance_binding',
    'circle_lifecycle', 'circle_policy', 'circle_seeded', 'communication',
    'communication_room_upgrade', 'draft_governance', 'external_app',
    'external_app_circle_binding', 'governance_bootstrap_activation', 'source_material',
    'governance_profile', 'governance_home_identity', 'governance_case', 'treasury_transfer',
    'realms_provider_binding', 'squads_provider_binding',
  ],
  uiSchemaMetadata: { schemaId: 'alcheme-governance-workspace-v1', labelKey: 'governance.profile.circle' },
});

/**
 * Explicit opt-in successor for Circle homes that govern a Storage Fabric
 * provider-admission decision. V1 remains immutable; activation requires the
 * normal governance-profile upgrade path plus the catalog feature flag.
 */
export const CIRCLE_GOVERNANCE_PROFILE_V2 = createGovernanceProfileDefinition({
  profileId: 'alcheme.circle.native',
  version: 2,
  supportedHomeTypes: ['circle'],
  identitySource: { type: 'governance_home_identity_binding', projection: 'circle' },
  membershipSource: { type: 'circle_membership', roleSchema: 'circle-member-role-v1' },
  dimensionApplicability: {
    admission: { status: 'applicable', reason: 'circle_has_membership', providerMapping: 'circle_membership' },
    proposal_creation: { status: 'applicable', reason: 'circle_policy', providerMapping: 'governance_policy' },
    voter_eligibility: { status: 'applicable', reason: 'frozen_circle_electorate', providerMapping: 'governance_snapshot' },
    voting_power: { status: 'applicable', reason: 'policy_strategy', providerMapping: 'governance_snapshot' },
  },
  actionCatalog: [
    ...CIRCLE_GOVERNANCE_PROFILE_V1.actionCatalog,
    'storage_fabric.*',
  ],
  authorityCapabilities: CIRCLE_GOVERNANCE_PROFILE_V1.authorityCapabilities,
  providerCapabilities: CIRCLE_GOVERNANCE_PROFILE_V1.providerCapabilities,
  adapterCapabilities: [
    ...CIRCLE_GOVERNANCE_PROFILE_V1.adapterCapabilities,
    'manual_case_execution',
  ],
  uiSchemaMetadata: { schemaId: 'alcheme-governance-workspace-v1', labelKey: 'governance.profile.circle' },
});

export const GRANT_CONFORMANCE_PROFILE_V1 = createGovernanceProfileDefinition({
  profileId: 'alcheme.grant.conformance',
  version: 1,
  supportedHomeTypes: ['external_institution'],
  identitySource: { type: 'governance_home_identity_binding', projection: 'grant' },
  membershipSource: { type: 'none', reason: 'grant_program_is_not_membership_organization' },
  dimensionApplicability: {
    admission: { status: 'not_applicable', reason: 'no_membership_admission', providerMapping: 'none' },
    proposal_creation: { status: 'applicable', reason: 'grant_reviewer_policy', providerMapping: 'governance_policy' },
    voter_eligibility: { status: 'applicable', reason: 'frozen_grant_reviewers', providerMapping: 'governance_snapshot' },
    voting_power: { status: 'applicable', reason: 'grant_review_policy', providerMapping: 'governance_snapshot' },
  },
  actionCatalog: ['grant.*', 'governance.profile.*', 'governance.home_identity.migrate'],
  authorityCapabilities: ['policy_binding', 'registered_adapter'],
  providerCapabilities: ['internal'],
  adapterCapabilities: ['grant_access', 'governance_profile', 'governance_home_identity'],
  uiSchemaMetadata: { schemaId: 'alcheme-governance-workspace-v1', labelKey: 'governance.profile.grant' },
});

export const EXTERNAL_APP_SYSTEM_GOVERNANCE_PROFILE_V1 = createGovernanceProfileDefinition({
  profileId: 'alcheme.external-app.system',
  version: 1,
  supportedHomeTypes: ['external_app_system_role'],
  identitySource: { type: 'governance_home_identity_binding', projection: 'external_app_system_domain' },
  membershipSource: { type: 'system_governance_role_binding', projection: 'review_circle_assignment' },
  dimensionApplicability: {
    admission: { status: 'not_applicable', reason: 'system_domain_has_no_membership_admission', providerMapping: 'none' },
    proposal_creation: { status: 'applicable', reason: 'external_app_owner_request', providerMapping: 'external_app_registry' },
    voter_eligibility: { status: 'applicable', reason: 'frozen_system_role_electorate', providerMapping: 'governance_snapshot' },
    voting_power: { status: 'applicable', reason: 'system_role_policy', providerMapping: 'governance_snapshot' },
  },
  actionCatalog: ['external_app.*', 'downgrade_discovery_status'],
  authorityCapabilities: ['system_governance_role_binding', 'registered_adapter'],
  providerCapabilities: ['internal'],
  adapterCapabilities: ['external_app'],
  uiSchemaMetadata: {
    schemaId: 'alcheme-governance-workspace-v1',
    labelKey: 'governance.profile.external_app_system',
  },
});

export const PLATFORM_SAFETY_SYSTEM_GOVERNANCE_PROFILE_V1 = createGovernanceProfileDefinition({
  profileId: 'alcheme.platform-safety.system',
  version: 1,
  supportedHomeTypes: ['platform_safety_system_role'],
  identitySource: {
    type: 'governance_home_identity_binding',
    projection: 'platform_safety_system_domain',
  },
  membershipSource: {
    type: 'system_governance_role_binding',
    projection: 'platform_safety_role_circle_assignment',
  },
  dimensionApplicability: {
    admission: {
      status: 'applicable',
      reason: 'signed_us_public_adult_demo_admission',
      providerMapping: 'public_demo_admission',
    },
    proposal_creation: {
      status: 'applicable',
      reason: 'bound_platform_safety_role',
      providerMapping: 'system_governance_role_binding',
    },
    voter_eligibility: {
      status: 'applicable',
      reason: 'frozen_platform_safety_role_electorate',
      providerMapping: 'governance_snapshot',
    },
    voting_power: {
      status: 'applicable',
      reason: 'one_person_one_vote_with_role_separation',
      providerMapping: 'governance_snapshot',
    },
  },
  actionCatalog: ['platform.safety.*'],
  authorityCapabilities: ['system_governance_role_binding', 'registered_adapter'],
  providerCapabilities: ['internal'],
  adapterCapabilities: ['platform_safety'],
  uiSchemaMetadata: {
    schemaId: 'alcheme-governance-workspace-v1',
    labelKey: 'governance.profile.platform_safety_system',
  },
});

export const GOVERNANCE_CAPABILITY_LAYERING = deepFreeze({
  circleGovernanceBindingDecisionPath: {
    implementation: 'CURRENT',
    completeness: 'PARTIAL',
    scope: 'decision_oriented_committee_request_and_legacy_checkpoint',
  },
  selfGovernedFullFlow: {
    implementation: 'TARGET',
    completeness: 'NOT_IMPLEMENTED',
    scope: 'case_stage_artifact_execution_outcome',
  },
  operationalMandate: {
    implementation: 'TARGET',
    completeness: 'NOT_IMPLEMENTED',
    scope: 'mandate_bound_operator_and_live_execution_authority',
  },
  genericGovernanceProfile: {
    implementation: 'TARGET',
    completeness: 'FOUNDATION_ONLY',
    scope: 'binding_lifecycle_provider_preflight_and_release_ui',
  },
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
