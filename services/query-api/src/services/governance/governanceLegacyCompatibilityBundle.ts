import {
  GOVERNANCE_CANONICAL_CODEC_VERSION,
  canonicalGovernanceJson,
  hashCanonicalGovernanceValue,
} from './canonicalCodec';

export const GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_DOMAIN =
  'alcheme.governance.legacy-compatibility-bundle' as const;

export const LEGACY_GOVERNANCE_ACTIONS = [
  'execute_transfer',
  'propose_transfer',
  'submit_ai_evaluation',
  'update_decision_engine',
  'vote',
] as const;

export type LegacyGovernanceAction = typeof LEGACY_GOVERNANCE_ACTIONS[number];
export type LegacyDisposition =
  | 'continue_legacy_direct'
  | 'migrate_to_invocation'
  | 'migrate_to_case'
  | 'read_only'
  | 'blocked';

export interface GovernanceLegacyCompatibilityBundleInput {
  network: 'solana:localnet';
  homeIdentity: { ref: string; version: number; digest: string };
  circleProjection: {
    circleId: number;
    onChainAddress: string;
    creatorPubkey: string | null;
    lifecycleStatus: string;
    kind: string;
    mode: string;
    minCrystals: number;
    lastSyncedSlot: number;
    stateDigest: string;
  };
  chainReadback: {
    circleId: number;
    accountRef: string;
    accountOwnerProgramId: string;
    programVersionRef: string;
    programIdlDigest: string;
    observedSlot: number;
    commitment: 'confirmed' | 'finalized';
    stateDigest: string;
    lifecycleStatus: string;
    flags: string;
    curators: string[];
    decisionEngine: { type: string; configDigest: string } | null;
  };
  roles: Array<{ actorRef: string; role: string; status: string; evidenceRef: string }>;
  routes: Array<{ actionType: string; routeRef: string; authority: string; status: string }>;
  bindings: Array<{ bindingRef: string; actionType: string | null; status: string; evidenceDigest: string }>;
  assetJobs: Array<{ jobRef: string; jobType: string; status: string; disposition: LegacyDisposition }>;
  providerRefs: Array<{ providerType: string; providerRef: string; versionRef: string }>;
  governanceRequests: Array<{ requestRef: string; actionType: string; state: string; disposition: LegacyDisposition }>;
  openTransferProposals: Array<{
    proposalRef: string;
    status: string;
    decisionEngineDigest: string;
    deadline: number | null;
    votesFor: number;
    votesAgainst: number;
    voters: number;
    disposition: LegacyDisposition;
  }>;
  actionMatrix: Array<{
    actionType: LegacyGovernanceAction;
    currentPath: string;
    authority: string;
    disposition: LegacyDisposition;
    inFlightRefs: string[];
    rollback: string;
    risk: string;
  }>;
  blockers: string[];
}

export interface GovernanceLegacyCompatibilityBundle
  extends GovernanceLegacyCompatibilityBundleInput {
  schemaVersion: typeof GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_SCHEMA_VERSION;
  canonicalCodecVersion: typeof GOVERNANCE_CANONICAL_CODEC_VERSION;
}

const INPUT_FIELDS = new Set([
  'network',
  'homeIdentity',
  'circleProjection',
  'chainReadback',
  'roles',
  'routes',
  'bindings',
  'assetJobs',
  'providerRefs',
  'governanceRequests',
  'openTransferProposals',
  'actionMatrix',
  'blockers',
]);
const DISPOSITIONS = new Set<LegacyDisposition>([
  'continue_legacy_direct',
  'migrate_to_invocation',
  'migrate_to_case',
  'read_only',
  'blocked',
]);

export function createGovernanceLegacyCompatibilityBundle(
  input: GovernanceLegacyCompatibilityBundleInput,
): { bundle: GovernanceLegacyCompatibilityBundle; canonicalJson: string; digest: string } {
  if (
    Object.keys(input).length !== INPUT_FIELDS.size
    || Object.keys(input).some((key) => !INPUT_FIELDS.has(key))
  ) {
    throw new Error('unsupported_governance_compatibility_bundle_field');
  }
  if (input.network !== 'solana:localnet') {
    throw new Error('governance_compatibility_devnet_not_enabled');
  }
  requireCircleId(input.circleProjection.circleId);
  requireCircleId(input.chainReadback.circleId);
  if (input.circleProjection.circleId !== input.chainReadback.circleId) {
    throw new Error('governance_compatibility_circle_mismatch');
  }
  if (input.circleProjection.onChainAddress !== input.chainReadback.accountRef) {
    throw new Error('governance_compatibility_circle_account_mismatch');
  }
  if (!Number.isSafeInteger(input.homeIdentity.version) || input.homeIdentity.version < 1) {
    throw new Error('invalid_governance_compatibility_home_identity_version');
  }
  requireCanonicalText(input.homeIdentity.ref);
  requireDigest(input.homeIdentity.digest);
  requireDigest(input.circleProjection.stateDigest);
  requireDigest(input.chainReadback.programIdlDigest);
  requireDigest(input.chainReadback.stateDigest);
  if (!Number.isSafeInteger(input.chainReadback.observedSlot) || input.chainReadback.observedSlot < 0) {
    throw new Error('invalid_governance_compatibility_observed_slot');
  }
  if (input.chainReadback.commitment !== 'confirmed' && input.chainReadback.commitment !== 'finalized') {
    throw new Error('invalid_governance_compatibility_commitment');
  }
  for (const value of [
    input.circleProjection.onChainAddress,
    input.chainReadback.accountOwnerProgramId,
    input.chainReadback.programVersionRef,
    ...input.chainReadback.curators,
  ]) requireCanonicalText(value);

  const actions = input.actionMatrix.map((item) => item.actionType);
  if (new Set(actions).size !== actions.length) {
    throw new Error('governance_compatibility_action_matrix_duplicate');
  }
  if (
    actions.length !== LEGACY_GOVERNANCE_ACTIONS.length
    || LEGACY_GOVERNANCE_ACTIONS.some((action) => !actions.includes(action))
  ) {
    throw new Error('governance_compatibility_action_matrix_incomplete');
  }
  for (const item of input.actionMatrix) {
    if (!DISPOSITIONS.has(item.disposition)) {
      throw new Error('invalid_governance_compatibility_disposition');
    }
    for (const value of [item.currentPath, item.authority, item.rollback, item.risk, ...item.inFlightRefs]) {
      requireCanonicalText(value);
    }
  }
  for (const item of [
    ...input.assetJobs,
    ...input.governanceRequests,
    ...input.openTransferProposals,
  ]) {
    if (!DISPOSITIONS.has(item.disposition)) {
      throw new Error('invalid_governance_compatibility_disposition');
    }
  }
  if (!input.chainReadback.decisionEngine && input.blockers.length === 0) {
    throw new Error('governance_compatibility_unresolved_fact_requires_blocker');
  }
  if (input.chainReadback.decisionEngine) {
    requireCanonicalText(input.chainReadback.decisionEngine.type);
    requireDigest(input.chainReadback.decisionEngine.configDigest);
  }

  const bundle = deepFreeze<GovernanceLegacyCompatibilityBundle>({
    schemaVersion: GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_SCHEMA_VERSION,
    canonicalCodecVersion: GOVERNANCE_CANONICAL_CODEC_VERSION,
    network: input.network,
    homeIdentity: { ...input.homeIdentity },
    circleProjection: { ...input.circleProjection },
    chainReadback: {
      ...input.chainReadback,
      curators: sortedStrings(input.chainReadback.curators),
      decisionEngine: input.chainReadback.decisionEngine
        ? { ...input.chainReadback.decisionEngine }
        : null,
    },
    roles: sortedObjects(input.roles, (item) => `${item.actorRef}:${item.role}:${item.status}`),
    routes: sortedObjects(input.routes, (item) => `${item.actionType}:${item.routeRef}`),
    bindings: sortedObjects(input.bindings, (item) => `${item.bindingRef}:${item.actionType ?? ''}`),
    assetJobs: sortedObjects(input.assetJobs, (item) => `${item.jobType}:${item.jobRef}`),
    providerRefs: sortedObjects(input.providerRefs, (item) => `${item.providerType}:${item.providerRef}`),
    governanceRequests: sortedObjects(input.governanceRequests, (item) => item.requestRef),
    openTransferProposals: sortedObjects(input.openTransferProposals, (item) => item.proposalRef),
    actionMatrix: sortedObjects(input.actionMatrix, (item) => item.actionType)
      .map((item) => ({ ...item, inFlightRefs: sortedStrings(item.inFlightRefs) })),
    blockers: sortedStrings(input.blockers),
  });
  return {
    bundle,
    canonicalJson: canonicalGovernanceJson(
      GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_DOMAIN,
      bundle,
    ),
    digest: hashCanonicalGovernanceValue(
      GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_DOMAIN,
      bundle,
    ),
  };
}

function sortedObjects<T extends Record<string, unknown>>(items: T[], key: (item: T) => string): T[] {
  return items.map((item) => ({ ...item })).sort((left, right) => key(left).localeCompare(key(right)));
}

function sortedStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => canonicalText(item)))].sort();
}

function requireCircleId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 255) {
    throw new Error('invalid_governance_compatibility_circle_id');
  }
}

function requireDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('invalid_governance_compatibility_digest');
  }
}

function requireCanonicalText(value: string): void {
  canonicalText(value);
}

function canonicalText(value: string): string {
  if (!value || value !== value.trim()) {
    throw new Error('non_canonical_governance_compatibility_fact');
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
