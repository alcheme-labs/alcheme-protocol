import {
  canonicalGovernanceJson,
  hashCanonicalGovernanceValue,
} from './canonicalCodec';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import {
  computeGovernanceDecisionDigest,
  type GovernanceDecisionRecord,
  type GovernanceEligibleActor,
} from './policyEngine';
import { verifyEd25519SignatureBase64 } from '../offchainDiscussion';

export const GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID = 'solana:localnet' as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID = 'solana:devnet' as const;
export type GovernanceBootstrapCeremonyNetwork =
  | typeof GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID
  | typeof GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID;
export const GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_DOMAIN =
  'alcheme.governance.bootstrap-confirmation-policy' as const;
export const GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_V2_SCHEMA_VERSION = 2 as const;
export const GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_V2_DOMAIN =
  'alcheme.governance.bootstrap-confirmation-policy-v2' as const;
export const GOVERNANCE_BOOTSTRAP_FOUNDING_SNAPSHOT_DOMAIN =
  'alcheme.governance.bootstrap-founding-snapshot' as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_DOMAIN =
  'alcheme.governance.bootstrap-ceremony-opening' as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_SCHEMA_VERSION = 2 as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN =
  'alcheme.governance.bootstrap-ceremony-opening-v2' as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_SIGNATURE_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_V2_SIGNATURE_VERSION = 2 as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_EVENT_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_OPENED_EVENT_TYPE =
  'ceremony_opened' as const;
export const GOVERNANCE_BOOTSTRAP_CEREMONY_OPENED_EVENT_STATUS =
  'recorded' as const;
export const GOVERNANCE_BOOTSTRAP_DELIVERY_OPERATION_TYPE =
  'bootstrap_ceremony_execute' as const;
export const GOVERNANCE_BOOTSTRAP_DELIVERY_PAYLOAD_SCHEMA_VERSION =
  'alcheme.governance.bootstrap-delivery.v1' as const;
export const GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID =
  'GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ' as const;
export const GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_DOMAIN =
  'alcheme.governance.bootstrap-circle-owner-proof' as const;
export const GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN =
  'alcheme.governance.bootstrap-opening-signature-evidence' as const;
export const GOVERNANCE_BOOTSTRAP_QUEUE_ELIGIBILITY_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_BOOTSTRAP_QUEUE_ELIGIBILITY_DOMAIN =
  'alcheme.governance.bootstrap-queue-eligibility' as const;

export interface GovernanceBootstrapCeremonyConfig {
  chainId: GovernanceBootstrapCeremonyNetwork;
}

export interface GovernanceBootstrapConfirmationPolicyInput {
  version: string;
  foundingMemberConfirmation: 'required' | 'not_required';
  authoritySignature: 'required' | 'not_required';
  timelock: 'required' | 'not_required';
  waitingPeriodSeconds: number;
  explanationRef: string;
  explanationDigest: string;
}

export interface GovernanceBootstrapConfirmationPolicy
  extends GovernanceBootstrapConfirmationPolicyInput {
  schemaVersion: typeof GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_SCHEMA_VERSION;
}

export interface GovernanceBootstrapFoundingMemberPolicyInput {
  eligibleSourceRef: string;
  eligibleSourceVersion: string;
  eligibleSourceDigest: string;
  eligibleActors: GovernanceEligibleActor[];
  threshold: {
    mode: 'default_majority' | 'fixed_count' | 'unanimity';
    value: number | null;
  };
}

export interface GovernanceBootstrapFoundingConfirmationPolicyV2Input {
  version: string;
  foundingMemberConfirmation: 'required' | 'not_required';
  authoritySignature: 'required' | 'not_required';
  timelock: 'required' | 'not_required';
  waitingPeriodSeconds: number;
  explanationRef: string;
  explanationDigest: string;
  homeIdentityBindingId: string;
  configurationBundleId: string;
  configurationBundleDigest: string;
  openedAt: string;
  foundingMemberPolicy: GovernanceBootstrapFoundingMemberPolicyInput | null;
}

export interface GovernanceBootstrapCeremonyOpeningInput {
  config: GovernanceBootstrapCeremonyConfig;
  ceremonyId: string;
  homeIdentityBindingId: string;
  configurationBundleId: string;
  configurationBundleVersion: number;
  configurationBundleDigest: string;
  actorPubkey: string;
  sourceAuthorityType: string;
  sourceAuthorityRef: string;
  sourceAuthorityDigest: string;
  confirmationPolicy: GovernanceBootstrapConfirmationPolicyInput;
  signatureNonce: string;
  openedAt: string;
  signatureExpiresAt: string;
  readinessDigest: string | null;
}

export interface GovernanceBootstrapCircleOwnerProofInput {
  network: GovernanceBootstrapCeremonyNetwork;
  homeIdentityBindingId: string;
  homeChainAccountRef: string;
  circleId: number;
  circleAccountRef: string;
  circleAccountOwnerProgramId: string;
  programId: string;
  programVersionRef: string;
  programIdlDigest: string;
  decodedCircleId: number;
  decodedStatus: 'Active' | 'Archived';
  decodedOwnerPubkey: string;
  actorPubkey: string;
  observedSlot: number;
  commitment: 'confirmed';
  stateDigest: string;
  observedAt: string;
  validUntil: string;
  projectionCreatorPubkey: string | null;
  unresolvedOwnerTransferCount: number;
}

export interface GovernanceBootstrapCeremonyOpeningV2Input {
  config: GovernanceBootstrapCeremonyConfig;
  ceremonyId: string;
  homeIdentityBindingId: string;
  configurationBundleId: string;
  configurationBundleVersion: number;
  configurationBundleDigest: string;
  actorPubkey: string;
  authorityProof: ReturnType<typeof createGovernanceBootstrapCircleOwnerProof>;
  confirmationPolicy: ReturnType<
    typeof createGovernanceBootstrapFoundingConfirmationPolicyV2
  >;
  signatureNonce: string;
  openedAt: string;
  signatureExpiresAt: string;
  readinessDigest: string | null;
}

export interface GovernanceBootstrapOpeningV2SignatureInput {
  opening: ReturnType<typeof createGovernanceBootstrapCeremonyOpeningV2>;
  authorityProof: ReturnType<typeof createGovernanceBootstrapCircleOwnerProof>;
  signatureBase64: string;
  now: string;
}

export interface GovernanceBootstrapQueueEligibilityInput {
  ceremony: {
    id: string;
    state: 'prepared';
    homeIdentityBindingId: string;
    configurationBundleId: string;
    governanceRequestId: string | null;
    confirmationPolicyDigest: string;
    waitingPeriodSeconds: number;
    readinessDigest: string | null;
    createdAt: string;
  };
  opening: {
    openingDigest: string;
    network: GovernanceBootstrapCeremonyNetwork;
    homeIdentityBindingId: string;
    configurationBundleId: string;
    confirmationPolicyDigest: string;
    foundingMemberConfirmation: 'required' | 'not_required';
  };
  signatureEvidence: ReturnType<
    typeof verifyGovernanceBootstrapCeremonyOpeningV2Signature
  > | null;
  decision: GovernanceDecisionRecord | null;
  now: string;
}

const OPENING_INPUT_FIELDS = new Set([
  'config',
  'ceremonyId',
  'homeIdentityBindingId',
  'configurationBundleId',
  'configurationBundleVersion',
  'configurationBundleDigest',
  'actorPubkey',
  'sourceAuthorityType',
  'sourceAuthorityRef',
  'sourceAuthorityDigest',
  'confirmationPolicy',
  'signatureNonce',
  'openedAt',
  'signatureExpiresAt',
  'readinessDigest',
]);

const OPENING_V2_INPUT_FIELDS = new Set([
  'config',
  'ceremonyId',
  'homeIdentityBindingId',
  'configurationBundleId',
  'configurationBundleVersion',
  'configurationBundleDigest',
  'actorPubkey',
  'authorityProof',
  'confirmationPolicy',
  'signatureNonce',
  'openedAt',
  'signatureExpiresAt',
  'readinessDigest',
]);

const OPENING_V2_SIGNATURE_INPUT_FIELDS = new Set([
  'opening',
  'authorityProof',
  'signatureBase64',
  'now',
]);

const QUEUE_ELIGIBILITY_INPUT_FIELDS = new Set([
  'ceremony',
  'opening',
  'signatureEvidence',
  'decision',
  'now',
]);

const QUEUE_ELIGIBILITY_CEREMONY_FIELDS = new Set([
  'id',
  'state',
  'homeIdentityBindingId',
  'configurationBundleId',
  'governanceRequestId',
  'confirmationPolicyDigest',
  'waitingPeriodSeconds',
  'readinessDigest',
  'createdAt',
]);

const QUEUE_ELIGIBILITY_OPENING_FIELDS = new Set([
  'openingDigest',
  'network',
  'homeIdentityBindingId',
  'configurationBundleId',
  'confirmationPolicyDigest',
  'foundingMemberConfirmation',
]);

const CIRCLE_OWNER_PROOF_INPUT_FIELDS = new Set([
  'network',
  'homeIdentityBindingId',
  'homeChainAccountRef',
  'circleId',
  'circleAccountRef',
  'circleAccountOwnerProgramId',
  'programId',
  'programVersionRef',
  'programIdlDigest',
  'decodedCircleId',
  'decodedStatus',
  'decodedOwnerPubkey',
  'actorPubkey',
  'observedSlot',
  'commitment',
  'stateDigest',
  'observedAt',
  'validUntil',
  'projectionCreatorPubkey',
  'unresolvedOwnerTransferCount',
]);

const CONFIRMATION_POLICY_FIELDS = new Set([
  'version',
  'foundingMemberConfirmation',
  'authoritySignature',
  'timelock',
  'waitingPeriodSeconds',
  'explanationRef',
  'explanationDigest',
]);

const FOUNDING_CONFIRMATION_POLICY_V2_FIELDS = new Set([
  ...CONFIRMATION_POLICY_FIELDS,
  'homeIdentityBindingId',
  'configurationBundleId',
  'configurationBundleDigest',
  'openedAt',
  'foundingMemberPolicy',
]);

const FOUNDING_MEMBER_POLICY_FIELDS = new Set([
  'eligibleSourceRef',
  'eligibleSourceVersion',
  'eligibleSourceDigest',
  'eligibleActors',
  'threshold',
]);

const FOUNDING_ELIGIBLE_ACTOR_FIELDS = new Set([
  'pubkey',
  'role',
  'weight',
  'source',
]);

const FOUNDING_THRESHOLD_FIELDS = new Set(['mode', 'value']);

export function resolveGovernanceBootstrapCeremonyConfig(
  env: Record<string, string | undefined> = process.env,
): GovernanceBootstrapCeremonyConfig {
  const chainId = env.GOVERNANCE_BOOTSTRAP_CHAIN_ID?.trim();
  if (!chainId) throw new Error('governance_bootstrap_chain_id_required');
  if (chainId !== GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID
    && chainId !== GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID) {
    throw new Error('unsupported_governance_bootstrap_chain_id');
  }
  return { chainId };
}

export function canonicalGovernanceBootstrapBundleVersion(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('invalid_governance_bootstrap_bundle_version');
  }
  return String(version);
}

export function createGovernanceBootstrapConfirmationPolicy(
  input: GovernanceBootstrapConfirmationPolicyInput,
): {
  policy: GovernanceBootstrapConfirmationPolicy;
  canonicalJson: string;
  digest: string;
} {
  if (
    Object.keys(input).length !== CONFIRMATION_POLICY_FIELDS.size
    || Object.keys(input).some((key) => !CONFIRMATION_POLICY_FIELDS.has(key))
  ) {
    throw new Error('unsupported_governance_bootstrap_confirmation_policy_field');
  }
  const version = requireCanonicalText(
    input.version,
    'governance_bootstrap_confirmation_version_required',
  );
  const explanationRef = requireCanonicalText(
    input.explanationRef,
    'governance_bootstrap_confirmation_explanation_required',
  );
  if (!isDigest(input.explanationDigest)) {
    throw new Error('invalid_governance_bootstrap_confirmation_explanation_digest');
  }
  for (const value of [
    input.foundingMemberConfirmation,
    input.authoritySignature,
    input.timelock,
  ]) {
    if (value !== 'required' && value !== 'not_required') {
      throw new Error('invalid_governance_bootstrap_confirmation_requirement');
    }
  }
  if (
    !Number.isSafeInteger(input.waitingPeriodSeconds)
    || input.waitingPeriodSeconds < 0
    || (input.timelock === 'required' && input.waitingPeriodSeconds === 0)
    || (input.timelock === 'not_required' && input.waitingPeriodSeconds !== 0)
  ) {
    throw new Error('governance_bootstrap_confirmation_waiting_period_mismatch');
  }
  const policy: GovernanceBootstrapConfirmationPolicy = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_SCHEMA_VERSION,
    version,
    foundingMemberConfirmation: input.foundingMemberConfirmation,
    authoritySignature: input.authoritySignature,
    timelock: input.timelock,
    waitingPeriodSeconds: input.waitingPeriodSeconds,
    explanationRef,
    explanationDigest: input.explanationDigest,
  };
  return deepFreeze({
    policy,
    canonicalJson: canonicalGovernanceJson(
      GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_DOMAIN,
      policy,
    ),
    digest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_DOMAIN,
      policy,
    ),
  });
}

export function createGovernanceBootstrapFoundingConfirmationPolicyV2(
  input: GovernanceBootstrapFoundingConfirmationPolicyV2Input,
) {
  assertExactFields(
    input,
    FOUNDING_CONFIRMATION_POLICY_V2_FIELDS,
    'unsupported_governance_bootstrap_confirmation_policy_v2_field',
  );
  if (input.foundingMemberPolicy !== null) {
    assertExactFields(
      input.foundingMemberPolicy,
      FOUNDING_MEMBER_POLICY_FIELDS,
      'unsupported_governance_bootstrap_confirmation_policy_v2_field',
    );
    assertExactFields(
      input.foundingMemberPolicy.threshold,
      FOUNDING_THRESHOLD_FIELDS,
      'unsupported_governance_bootstrap_confirmation_policy_v2_field',
    );
    for (const actor of input.foundingMemberPolicy.eligibleActors) {
      assertExactFields(
        actor,
        FOUNDING_ELIGIBLE_ACTOR_FIELDS,
        'unsupported_governance_bootstrap_confirmation_policy_v2_field',
      );
    }
  }
  const version = requireCanonicalText(
    input.version,
    'governance_bootstrap_confirmation_version_required',
  );
  const explanationRef = requireCanonicalText(
    input.explanationRef,
    'governance_bootstrap_confirmation_explanation_required',
  );
  const homeIdentityBindingId = requireCanonicalText(
    input.homeIdentityBindingId,
    'governance_bootstrap_home_identity_required',
  );
  const configurationBundleId = requireCanonicalText(
    input.configurationBundleId,
    'governance_bootstrap_configuration_bundle_required',
  );
  const openedAt = requireCanonicalIsoDate(
    input.openedAt,
    'invalid_governance_bootstrap_opened_at',
  );
  for (const value of [
    input.foundingMemberConfirmation,
    input.authoritySignature,
    input.timelock,
  ]) {
    if (value !== 'required' && value !== 'not_required') {
      throw new Error('invalid_governance_bootstrap_confirmation_requirement');
    }
  }
  if (
    !Number.isSafeInteger(input.waitingPeriodSeconds)
    || input.waitingPeriodSeconds < 0
    || (input.timelock === 'required' && input.waitingPeriodSeconds === 0)
    || (input.timelock === 'not_required' && input.waitingPeriodSeconds !== 0)
  ) {
    throw new Error('governance_bootstrap_confirmation_waiting_period_mismatch');
  }
  if (!isDigest(input.explanationDigest) || !isDigest(input.configurationBundleDigest)) {
    throw new Error('invalid_governance_bootstrap_confirmation_digest');
  }
  if (
    (input.foundingMemberConfirmation === 'required')
      !== (input.foundingMemberPolicy !== null)
  ) {
    throw new Error('governance_bootstrap_founding_confirmation_policy_mismatch');
  }
  const foundingMemberPolicy = input.foundingMemberPolicy === null
    ? null
    : createFoundingMemberPolicy({
      ...input.foundingMemberPolicy,
      homeIdentityBindingId,
      configurationBundleId,
      configurationBundleDigest: input.configurationBundleDigest,
      confirmationPolicyVersion: version,
      openedAt,
    });
  const policy = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_V2_SCHEMA_VERSION,
    version,
    foundingMemberConfirmation: input.foundingMemberConfirmation,
    authoritySignature: input.authoritySignature,
    timelock: input.timelock,
    waitingPeriodSeconds: input.waitingPeriodSeconds,
    explanationRef,
    explanationDigest: input.explanationDigest,
    homeIdentityBindingId,
    configurationBundleId,
    configurationBundleDigest: input.configurationBundleDigest,
    openedAt,
    foundingMemberPolicy,
  };
  const requestFacts = foundingMemberPolicy === null
    ? null
    : {
      scope: { type: 'governance_home' as const, ref: homeIdentityBindingId },
      action: {
        type: 'governance.bootstrap.founding_confirmation' as const,
        targetType: 'governance_configuration_bundle' as const,
        targetRef: configurationBundleId,
        payload: {
          configurationBundleDigest: input.configurationBundleDigest,
          confirmationPolicyVersion: version,
        },
      },
      eligibleActors: foundingMemberPolicy.eligibleActors,
      strategyConfig: {
        strategy: 'committee.member_threshold' as const,
        threshold: foundingMemberPolicy.threshold,
        ballotDisclosure: { mode: 'member' as const },
      },
    };
  const snapshotFacts = foundingMemberPolicy === null
    ? null
    : {
      eligibleActors: foundingMemberPolicy.eligibleActors,
      sourceDigest: foundingMemberPolicy.snapshotDigest,
      createdAt: openedAt,
    };
  return deepFreeze({
    policy,
    canonicalJson: canonicalGovernanceJson(
      GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_V2_DOMAIN,
      policy,
    ),
    digest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_V2_DOMAIN,
      policy,
    ),
    requestFacts,
    snapshotFacts,
  });
}

function createFoundingMemberPolicy(
  input: GovernanceBootstrapFoundingMemberPolicyInput & {
    homeIdentityBindingId: string;
    configurationBundleId: string;
    configurationBundleDigest: string;
    confirmationPolicyVersion: string;
    openedAt: string;
  },
) {
  const eligibleSourceRef = requireCanonicalText(
    input.eligibleSourceRef,
    'governance_bootstrap_eligible_source_required',
  );
  const eligibleSourceVersion = requireCanonicalText(
    input.eligibleSourceVersion,
    'governance_bootstrap_eligible_source_required',
  );
  if (!isDigest(input.eligibleSourceDigest)) {
    throw new Error('invalid_governance_bootstrap_eligible_source_digest');
  }
  if (input.eligibleActors.length === 0) {
    throw new Error('governance_bootstrap_eligible_actor_required');
  }
  const eligibleActors = input.eligibleActors.map((actor) => {
    const pubkey = canonicalSolanaPublicKeyString(actor.pubkey);
    if (!pubkey || pubkey !== actor.pubkey) {
      throw new Error('invalid_governance_bootstrap_eligible_actor_pubkey');
    }
    if (actor.source !== 'founding_member') {
      throw new Error('governance_bootstrap_eligible_actor_source_mismatch');
    }
    if (
      (actor.role !== null
        && (!actor.role || actor.role !== actor.role.trim() || actor.role.length > 64))
      || actor.weight !== '1'
    ) {
      throw new Error('unsupported_governance_bootstrap_eligible_actor_semantics');
    }
    return { ...actor, pubkey };
  }).sort((left, right) => left.pubkey.localeCompare(right.pubkey));
  if (new Set(eligibleActors.map((actor) => actor.pubkey)).size !== eligibleActors.length) {
    throw new Error('duplicate_governance_bootstrap_eligible_actor');
  }
  if (!['default_majority', 'fixed_count', 'unanimity'].includes(input.threshold.mode)) {
    throw new Error('invalid_governance_bootstrap_confirmation_threshold_mode');
  }
  if (input.threshold.mode !== 'fixed_count' && input.threshold.value !== null) {
    throw new Error('governance_bootstrap_confirmation_threshold_mismatch');
  }
  if (
    input.threshold.mode === 'fixed_count'
    && (!Number.isSafeInteger(input.threshold.value)
      || (input.threshold.value ?? 0) < 1
      || (input.threshold.value ?? 0) > eligibleActors.length)
  ) {
    throw new Error('unreachable_governance_bootstrap_confirmation_threshold');
  }
  const threshold = {
    mode: input.threshold.mode,
    value: input.threshold.value,
  };
  const snapshotDigest = hashCanonicalGovernanceValue(
    GOVERNANCE_BOOTSTRAP_FOUNDING_SNAPSHOT_DOMAIN,
    {
      homeIdentityBindingId: input.homeIdentityBindingId,
      configurationBundleId: input.configurationBundleId,
      configurationBundleDigest: input.configurationBundleDigest,
      confirmationPolicyVersion: input.confirmationPolicyVersion,
      eligibleSourceRef,
      eligibleSourceVersion,
      eligibleSourceDigest: input.eligibleSourceDigest,
      eligibleActors,
      threshold,
      openedAt: input.openedAt,
    },
  );
  return {
    eligibleSourceRef,
    eligibleSourceVersion,
    eligibleSourceDigest: input.eligibleSourceDigest,
    eligibleActors,
    threshold,
    snapshotDigest,
  };
}

export function createGovernanceBootstrapCeremonyOpening(
  input: GovernanceBootstrapCeremonyOpeningInput,
) {
  if (
    Object.keys(input).length !== OPENING_INPUT_FIELDS.size
    || Object.keys(input).some((key) => !OPENING_INPUT_FIELDS.has(key))
  ) {
    throw new Error('unsupported_governance_bootstrap_opening_field');
  }
  assertOpeningConfig(input.config);
  const ceremonyId = requireCanonicalText(
    input.ceremonyId,
    'governance_bootstrap_ceremony_id_required',
  );
  const homeIdentityBindingId = requireCanonicalText(
    input.homeIdentityBindingId,
    'governance_bootstrap_home_identity_required',
  );
  const configurationBundleId = requireCanonicalText(
    input.configurationBundleId,
    'governance_bootstrap_configuration_bundle_required',
  );
  const sourceAuthorityType = requireCanonicalText(
    input.sourceAuthorityType,
    'governance_bootstrap_source_authority_required',
  );
  const sourceAuthorityRef = requireCanonicalText(
    input.sourceAuthorityRef,
    'governance_bootstrap_source_authority_required',
  );
  const signatureNonce = requireCanonicalText(
    input.signatureNonce,
    'governance_bootstrap_signature_nonce_required',
  );
  if (signatureNonce.length > 128) {
    throw new Error('invalid_governance_bootstrap_signature_nonce');
  }
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actorPubkey || actorPubkey !== input.actorPubkey) {
    throw new Error('invalid_governance_bootstrap_actor_pubkey');
  }
  for (const [value, errorCode] of [
    [input.configurationBundleDigest, 'invalid_governance_bootstrap_bundle_digest'],
    [input.sourceAuthorityDigest, 'invalid_governance_bootstrap_source_authority_digest'],
    [input.readinessDigest, 'invalid_governance_bootstrap_readiness_digest'],
  ] as const) {
    if (value !== null && !isDigest(value)) throw new Error(errorCode);
  }
  const openedAt = requireCanonicalIsoDate(
    input.openedAt,
    'invalid_governance_bootstrap_opened_at',
  );
  const signatureExpiresAt = requireCanonicalIsoDate(
    input.signatureExpiresAt,
    'invalid_governance_bootstrap_signature_expiry',
  );
  if (Date.parse(signatureExpiresAt) <= Date.parse(openedAt)) {
    throw new Error('invalid_governance_bootstrap_signature_window');
  }
  const bundleVersion = canonicalGovernanceBootstrapBundleVersion(
    input.configurationBundleVersion,
  );
  const confirmation = createGovernanceBootstrapConfirmationPolicy(
    input.confirmationPolicy,
  );
  const opening = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_SCHEMA_VERSION,
    domain: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_DOMAIN,
    signatureVersion: GOVERNANCE_BOOTSTRAP_CEREMONY_SIGNATURE_VERSION,
    network: input.config.chainId,
    ceremonyId,
    homeIdentityBindingId,
    configurationBundleId,
    configurationBundleVersion: bundleVersion,
    configurationBundleDigest: input.configurationBundleDigest,
    actorPubkey,
    sourceAuthorityType,
    sourceAuthorityRef,
    sourceAuthorityDigest: input.sourceAuthorityDigest,
    confirmationPolicyVersion: confirmation.policy.version,
    confirmationPolicyDigest: confirmation.digest,
    waitingPeriodSeconds: confirmation.policy.waitingPeriodSeconds,
    signatureNonce,
    openedAt,
    signatureExpiresAt,
    readinessDigest: input.readinessDigest,
  };
  const openingCanonicalJson = canonicalGovernanceJson(
    GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_DOMAIN,
    opening,
  );
  const openingDigest = hashCanonicalGovernanceValue(
    GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_DOMAIN,
    opening,
  );
  const operationKey = `bootstrap-ceremony:${openingDigest}`;
  const deliveryPayload = {
    ceremonyId,
    homeIdentityBindingId,
    openingDigest,
    operationType: GOVERNANCE_BOOTSTRAP_DELIVERY_OPERATION_TYPE,
    payloadSchemaVersion: GOVERNANCE_BOOTSTRAP_DELIVERY_PAYLOAD_SCHEMA_VERSION,
  };
  const payloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.bootstrap-delivery-payload',
    deliveryPayload,
  );
  const initialEvent = {
    sequence: 1,
    eventType: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENED_EVENT_TYPE,
    status: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENED_EVENT_STATUS,
    schemaVersion: GOVERNANCE_BOOTSTRAP_CEREMONY_EVENT_SCHEMA_VERSION,
    operationKey: null,
    attempt: null,
    evidenceRefs: [] as string[],
    evidenceDigest: null,
    occurredAt: openedAt,
    eventDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.bootstrap-ceremony-event',
      {
        ceremonyId,
        eventType: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENED_EVENT_TYPE,
        evidenceDigest: null,
        evidenceRefs: [],
        occurredAt: openedAt,
        openingDigest,
        sequence: 1,
        status: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENED_EVENT_STATUS,
      },
    ),
  };
  const blockedDelivery = {
    operationKey,
    operationType: GOVERNANCE_BOOTSTRAP_DELIVERY_OPERATION_TYPE,
    attempt: 1,
    payloadSchemaVersion: GOVERNANCE_BOOTSTRAP_DELIVERY_PAYLOAD_SCHEMA_VERSION,
    payloadDigest,
    idempotencyKey: `${operationKey}:1`,
    status: 'blocked' as const,
  };
  return deepFreeze({
    activationBundleVersion: bundleVersion,
    confirmationPolicy: confirmation.policy,
    confirmationPolicyDigest: confirmation.digest,
    opening,
    openingCanonicalJson,
    openingDigest,
    signedMessage: `alcheme-governance-bootstrap-ceremony-v1:${openingCanonicalJson}`,
    initialEvent,
    blockedDelivery,
  });
}

export function createGovernanceBootstrapCeremonyOpeningV2(
  input: GovernanceBootstrapCeremonyOpeningV2Input,
) {
  assertExactFields(
    input,
    OPENING_V2_INPUT_FIELDS,
    'unsupported_governance_bootstrap_opening_v2_field',
  );
  assertOpeningConfig(input.config);
  const ceremonyId = requireCanonicalText(
    input.ceremonyId,
    'governance_bootstrap_ceremony_id_required',
  );
  const homeIdentityBindingId = requireCanonicalText(
    input.homeIdentityBindingId,
    'governance_bootstrap_home_identity_required',
  );
  const configurationBundleId = requireCanonicalText(
    input.configurationBundleId,
    'governance_bootstrap_configuration_bundle_required',
  );
  const signatureNonce = requireCanonicalText(
    input.signatureNonce,
    'governance_bootstrap_signature_nonce_required',
  );
  if (signatureNonce.length > 128) {
    throw new Error('invalid_governance_bootstrap_signature_nonce');
  }
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actorPubkey || actorPubkey !== input.actorPubkey) {
    throw new Error('invalid_governance_bootstrap_actor_pubkey');
  }
  if (!isDigest(input.configurationBundleDigest)) {
    throw new Error('invalid_governance_bootstrap_bundle_digest');
  }
  if (input.readinessDigest !== null && !isDigest(input.readinessDigest)) {
    throw new Error('invalid_governance_bootstrap_readiness_digest');
  }
  const openedAt = requireCanonicalIsoDate(
    input.openedAt,
    'invalid_governance_bootstrap_opened_at',
  );
  const signatureExpiresAt = requireCanonicalIsoDate(
    input.signatureExpiresAt,
    'invalid_governance_bootstrap_signature_expiry',
  );
  if (Date.parse(signatureExpiresAt) <= Date.parse(openedAt)) {
    throw new Error('invalid_governance_bootstrap_signature_window');
  }
  const bundleVersion = canonicalGovernanceBootstrapBundleVersion(
    input.configurationBundleVersion,
  );
  const authority = input.authorityProof;
  const confirmation = input.confirmationPolicy;
  if (
    authority.proofDigest !== hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_DOMAIN,
      authority.proof,
    )
    || authority.authoritySourceRef !== [
      authority.proof.network,
      authority.proof.programId,
      authority.proof.circleAccountRef,
      String(authority.proof.observedSlot),
    ].join(':')
    || authority.authoritySourceVersion !== authority.proof.programVersionRef
    || authority.proof.network !== input.config.chainId
  ) {
    throw new Error('governance_bootstrap_opening_v2_authority_proof_mismatch');
  }
  if (
    confirmation.digest !== hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_CONFIRMATION_POLICY_V2_DOMAIN,
      confirmation.policy,
    )
  ) {
    throw new Error('governance_bootstrap_opening_v2_confirmation_digest_mismatch');
  }
  if (
    authority.proof.homeIdentityBindingId !== homeIdentityBindingId
    || confirmation.policy.homeIdentityBindingId !== homeIdentityBindingId
  ) {
    throw new Error('governance_bootstrap_opening_v2_home_mismatch');
  }
  if (authority.proof.actorPubkey !== actorPubkey) {
    throw new Error('governance_bootstrap_opening_v2_actor_mismatch');
  }
  if (
    confirmation.policy.configurationBundleId !== configurationBundleId
    || confirmation.policy.configurationBundleDigest !== input.configurationBundleDigest
    || confirmation.policy.openedAt !== openedAt
  ) {
    throw new Error('governance_bootstrap_opening_v2_confirmation_mismatch');
  }
  const confirmationSnapshotDigest =
    confirmation.policy.foundingMemberPolicy?.snapshotDigest ?? null;
  if (
    (confirmation.policy.foundingMemberConfirmation === 'required'
      && (confirmation.requestFacts === null
        || confirmation.snapshotFacts?.sourceDigest !== confirmationSnapshotDigest))
    || (confirmation.policy.foundingMemberConfirmation === 'not_required'
      && (confirmation.requestFacts !== null
        || confirmation.snapshotFacts !== null
        || confirmationSnapshotDigest !== null))
  ) {
    throw new Error('governance_bootstrap_opening_v2_confirmation_snapshot_mismatch');
  }
  const opening = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_SCHEMA_VERSION,
    domain: GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN,
    signatureVersion: GOVERNANCE_BOOTSTRAP_CEREMONY_V2_SIGNATURE_VERSION,
    network: input.config.chainId,
    ceremonyId,
    homeIdentityBindingId,
    configurationBundleId,
    configurationBundleVersion: bundleVersion,
    configurationBundleDigest: input.configurationBundleDigest,
    actorPubkey,
    authoritySourceType: authority.proof.authoritySourceType,
    authoritySourceRef: authority.authoritySourceRef,
    authoritySourceVersion: authority.authoritySourceVersion,
    authorityProofDigest: authority.proofDigest,
    confirmationPolicyVersion: confirmation.policy.version,
    confirmationPolicyDigest: confirmation.digest,
    foundingMemberConfirmation: confirmation.policy.foundingMemberConfirmation,
    confirmationSnapshotDigest,
    waitingPeriodSeconds: confirmation.policy.waitingPeriodSeconds,
    signatureNonce,
    openedAt,
    signatureExpiresAt,
    readinessDigest: input.readinessDigest,
  };
  const openingCanonicalJson = canonicalGovernanceJson(
    GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN,
    opening,
  );
  return deepFreeze({
    opening,
    openingCanonicalJson,
    openingDigest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN,
      opening,
    ),
    signedMessage: `alcheme-governance-bootstrap-ceremony-v2:${openingCanonicalJson}`,
  });
}

export function verifyGovernanceBootstrapCeremonyOpeningV2Signature(
  input: GovernanceBootstrapOpeningV2SignatureInput,
) {
  assertExactFields(
    input,
    OPENING_V2_SIGNATURE_INPUT_FIELDS,
    'unsupported_governance_bootstrap_opening_signature_field',
  );
  const openingCanonicalJson = canonicalGovernanceJson(
    GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN,
    input.opening.opening,
  );
  const openingDigest = hashCanonicalGovernanceValue(
    GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN,
    input.opening.opening,
  );
  const signedMessage = `alcheme-governance-bootstrap-ceremony-v2:${openingCanonicalJson}`;
  if (
    input.opening.opening.schemaVersion
      !== GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_SCHEMA_VERSION
    || input.opening.opening.domain !== GOVERNANCE_BOOTSTRAP_CEREMONY_OPENING_V2_DOMAIN
    || input.opening.opening.signatureVersion
      !== GOVERNANCE_BOOTSTRAP_CEREMONY_V2_SIGNATURE_VERSION
    || (input.opening.opening.network !== GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID
      && input.opening.opening.network !== GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID)
    || input.opening.openingCanonicalJson !== openingCanonicalJson
    || input.opening.openingDigest !== openingDigest
    || input.opening.signedMessage !== signedMessage
  ) {
    throw new Error('governance_bootstrap_opening_v2_digest_mismatch');
  }
  const authorityProofDigest = hashCanonicalGovernanceValue(
    GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_DOMAIN,
    input.authorityProof.proof,
  );
  if (
    input.authorityProof.proofDigest !== authorityProofDigest
    || input.authorityProof.proof.network !== input.opening.opening.network
    || input.authorityProof.proof.homeIdentityBindingId
      !== input.opening.opening.homeIdentityBindingId
    || input.authorityProof.proof.actorPubkey !== input.opening.opening.actorPubkey
    || authorityProofDigest !== input.opening.opening.authorityProofDigest
  ) {
    throw new Error('governance_bootstrap_opening_v2_authority_proof_mismatch');
  }
  const now = requireCanonicalIsoDate(
    input.now,
    'invalid_governance_bootstrap_signature_verified_at',
  );
  const nowMs = Date.parse(now);
  if (
    nowMs < Date.parse(input.opening.opening.openedAt)
    || nowMs < Date.parse(input.authorityProof.proof.observedAt)
  ) {
    throw new Error('governance_bootstrap_opening_signature_not_yet_valid');
  }
  if (
    nowMs > Date.parse(input.opening.opening.signatureExpiresAt)
    || nowMs > Date.parse(input.authorityProof.proof.validUntil)
  ) {
    throw new Error('governance_bootstrap_opening_signature_expired');
  }
  if (!verifyEd25519SignatureBase64({
    senderPubkey: input.opening.opening.actorPubkey,
    message: input.opening.signedMessage,
    signatureBase64: input.signatureBase64,
  })) {
    throw new Error('invalid_governance_bootstrap_opening_signature');
  }
  const signatureDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.bootstrap-opening-signature',
    { signatureBase64: input.signatureBase64 },
  );
  const evidence = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_SCHEMA_VERSION,
    domain: GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN,
    signatureScheme: 'ed25519' as const,
    signatureVersion: 'ed25519-detached-v1' as const,
    network: input.opening.opening.network,
    actorPubkey: input.opening.opening.actorPubkey,
    openingDigest,
    authorityProofDigest,
    signatureDigest,
    verifiedAt: now,
  };
  return deepFreeze({
    evidence,
    signatureEvidenceRef:
      `bootstrap-opening-signature:${openingDigest}:${input.opening.opening.actorPubkey}`,
    signatureEvidenceVersion: 'ed25519-detached-v1' as const,
    signatureEvidenceDigest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN,
      evidence,
    ),
  });
}

export function evaluateGovernanceBootstrapQueueEligibility(
  input: GovernanceBootstrapQueueEligibilityInput,
) {
  assertExactFields(
    input,
    QUEUE_ELIGIBILITY_INPUT_FIELDS,
    'unsupported_governance_bootstrap_queue_eligibility_field',
  );
  assertExactFields(
    input.ceremony,
    QUEUE_ELIGIBILITY_CEREMONY_FIELDS,
    'unsupported_governance_bootstrap_queue_eligibility_field',
  );
  assertExactFields(
    input.opening,
    QUEUE_ELIGIBILITY_OPENING_FIELDS,
    'unsupported_governance_bootstrap_queue_eligibility_field',
  );
  const ceremonyId = requireCanonicalText(
    input.ceremony.id,
    'governance_bootstrap_ceremony_id_required',
  );
  const createdAt = requireCanonicalIsoDate(
    input.ceremony.createdAt,
    'invalid_governance_bootstrap_ceremony_created_at',
  );
  const evaluatedAt = requireCanonicalIsoDate(
    input.now,
    'invalid_governance_bootstrap_queue_evaluated_at',
  );
  if (
    input.ceremony.state !== 'prepared'
    || (input.opening.network !== GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID
      && input.opening.network !== GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID)
    || input.ceremony.homeIdentityBindingId !== input.opening.homeIdentityBindingId
    || input.ceremony.configurationBundleId !== input.opening.configurationBundleId
    || input.ceremony.confirmationPolicyDigest !== input.opening.confirmationPolicyDigest
    || !isDigest(input.opening.openingDigest)
    || !isDigest(input.ceremony.confirmationPolicyDigest)
    || (input.ceremony.readinessDigest !== null
      && !isDigest(input.ceremony.readinessDigest))
  ) {
    throw new Error('governance_bootstrap_queue_eligibility_fact_mismatch');
  }
  if (
    !Number.isSafeInteger(input.ceremony.waitingPeriodSeconds)
    || input.ceremony.waitingPeriodSeconds < 0
  ) {
    throw new Error('invalid_governance_bootstrap_waiting_period');
  }
  let signatureEvidenceDigest: string | null = null;
  if (input.signatureEvidence) {
    signatureEvidenceDigest = hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN,
      input.signatureEvidence.evidence,
    );
    if (
      input.signatureEvidence.signatureEvidenceDigest !== signatureEvidenceDigest
      || input.signatureEvidence.evidence.openingDigest !== input.opening.openingDigest
      || input.signatureEvidence.evidence.network !== input.opening.network
    ) {
      throw new Error('governance_bootstrap_signature_evidence_mismatch');
    }
  }
  let decisionDigest: string | null = null;
  if (input.opening.foundingMemberConfirmation === 'required') {
    if (input.decision && input.ceremony.governanceRequestId) {
      decisionDigest = computeGovernanceDecisionDigest({
        requestId: input.decision.requestId,
        decision: input.decision.decision,
        reason: input.decision.reason,
        tally: input.decision.tally,
        decidedAt: input.decision.decidedAt,
        executableFrom: input.decision.executableFrom,
        executableUntil: input.decision.executableUntil,
      });
      if (
        input.decision.requestId !== input.ceremony.governanceRequestId
        || input.decision.decision !== 'accepted'
        || input.decision.decisionDigest !== decisionDigest
      ) {
        throw new Error('governance_bootstrap_confirmation_decision_mismatch');
      }
    }
  } else if (input.decision !== null || input.ceremony.governanceRequestId !== null) {
    throw new Error('governance_bootstrap_unexpected_confirmation_decision');
  }
  const availableAt = new Date(
    Date.parse(createdAt) + input.ceremony.waitingPeriodSeconds * 1000,
  ).toISOString();
  const blocker = input.ceremony.readinessDigest === null
    ? 'readiness_missing' as const
    : input.signatureEvidence === null
      ? 'signature_evidence_missing' as const
      : input.opening.foundingMemberConfirmation === 'required'
        && (!input.decision || !input.ceremony.governanceRequestId)
        ? 'confirmation_decision_missing' as const
        : Date.parse(evaluatedAt) < Date.parse(availableAt)
          ? 'timelock_pending' as const
          : null;
  const gate = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_QUEUE_ELIGIBILITY_SCHEMA_VERSION,
    domain: GOVERNANCE_BOOTSTRAP_QUEUE_ELIGIBILITY_DOMAIN,
    status: blocker ? 'blocked' as const : 'eligible' as const,
    blocker,
    ceremonyId,
    openingDigest: input.opening.openingDigest,
    signatureEvidenceDigest,
    decisionDigest,
    readinessDigest: input.ceremony.readinessDigest,
    availableAt,
    evaluatedAt,
  };
  return deepFreeze({
    gate,
    gateDigest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_QUEUE_ELIGIBILITY_DOMAIN,
      gate,
    ),
  });
}

export function createGovernanceBootstrapCircleOwnerProof(
  input: GovernanceBootstrapCircleOwnerProofInput,
) {
  if (
    Object.keys(input).length !== CIRCLE_OWNER_PROOF_INPUT_FIELDS.size
    || Object.keys(input).some((key) => !CIRCLE_OWNER_PROOF_INPUT_FIELDS.has(key))
  ) {
    throw new Error('unsupported_governance_bootstrap_circle_owner_proof_field');
  }
  for (const value of [input.homeIdentityBindingId, input.programVersionRef]) {
    requireCanonicalText(value, 'governance_bootstrap_circle_owner_proof_fact_required');
  }
  if (input.homeIdentityBindingId.length > 96 || input.programVersionRef.length > 64) {
    throw new Error('governance_bootstrap_circle_owner_proof_fact_too_long');
  }
  if (
    !Number.isSafeInteger(input.circleId)
    || input.circleId < 1
    || input.circleId > 255
    || !Number.isSafeInteger(input.decodedCircleId)
    || input.decodedCircleId < 1
    || input.decodedCircleId > 255
  ) {
    throw new Error('invalid_governance_bootstrap_circle_id');
  }
  if (!isDigest(input.programIdlDigest) || !isDigest(input.stateDigest)) {
    throw new Error('invalid_governance_bootstrap_circle_owner_proof_digest');
  }
  if (!Number.isSafeInteger(input.observedSlot) || input.observedSlot < 0) {
    throw new Error('invalid_governance_bootstrap_circle_owner_observed_slot');
  }
  if ((input as { commitment?: string }).commitment !== 'confirmed') {
    throw new Error('unsupported_governance_bootstrap_circle_owner_commitment');
  }
  if (input.decodedStatus !== 'Active' && input.decodedStatus !== 'Archived') {
    throw new Error('invalid_governance_bootstrap_circle_status');
  }
  const observedAt = requireCanonicalIsoDate(
    input.observedAt,
    'invalid_governance_bootstrap_circle_owner_observed_at',
  );
  const validUntil = requireCanonicalIsoDate(
    input.validUntil,
    'invalid_governance_bootstrap_circle_owner_valid_until',
  );
  if (Date.parse(validUntil) <= Date.parse(observedAt)) {
    throw new Error('invalid_governance_bootstrap_circle_owner_validity_window');
  }
  for (const pubkey of [
    input.homeChainAccountRef,
    input.circleAccountRef,
    input.circleAccountOwnerProgramId,
    input.programId,
    input.decodedOwnerPubkey,
    input.actorPubkey,
    input.projectionCreatorPubkey,
  ]) {
    if (pubkey !== null && canonicalSolanaPublicKeyString(pubkey) !== pubkey) {
      throw new Error('invalid_governance_bootstrap_circle_owner_pubkey');
    }
  }
  if (
    !Number.isSafeInteger(input.unresolvedOwnerTransferCount)
    || input.unresolvedOwnerTransferCount < 0
  ) {
    throw new Error('invalid_governance_bootstrap_owner_transfer_count');
  }
  if ((input as { network?: string }).network !== GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID
    && (input as { network?: string }).network !== GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID) {
    throw new Error('unsupported_governance_bootstrap_chain_id');
  }
  if (input.programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
    throw new Error('governance_bootstrap_circle_program_mismatch');
  }
  if (input.circleAccountOwnerProgramId !== input.programId) {
    throw new Error('governance_bootstrap_circle_account_owner_mismatch');
  }
  if (input.homeChainAccountRef !== input.circleAccountRef) {
    throw new Error('governance_bootstrap_circle_home_account_mismatch');
  }
  if (input.decodedCircleId !== input.circleId) {
    throw new Error('governance_bootstrap_circle_id_mismatch');
  }
  if (input.actorPubkey !== input.decodedOwnerPubkey) {
    throw new Error('governance_bootstrap_circle_owner_actor_mismatch');
  }
  if (
    input.projectionCreatorPubkey !== null
    && input.projectionCreatorPubkey !== input.decodedOwnerPubkey
  ) {
    throw new Error('governance_bootstrap_owner_projection_chain_mismatch');
  }
  if (input.unresolvedOwnerTransferCount !== 0) {
    throw new Error('governance_bootstrap_owner_transfer_divergence');
  }
  const proof = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_SCHEMA_VERSION,
    domain: GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_DOMAIN,
    network: input.network,
    authoritySourceType: 'circle_chain_owner' as const,
    homeIdentityBindingId: input.homeIdentityBindingId,
    homeChainAccountRef: input.homeChainAccountRef,
    circleId: input.circleId,
    circleAccountRef: input.circleAccountRef,
    circleAccountOwnerProgramId: input.circleAccountOwnerProgramId,
    programId: input.programId,
    programVersionRef: input.programVersionRef,
    programIdlDigest: input.programIdlDigest,
    decodedCircleId: input.decodedCircleId,
    decodedStatus: input.decodedStatus,
    actorPubkey: input.actorPubkey,
    observedOwnerPubkey: input.decodedOwnerPubkey,
    observedSlot: input.observedSlot,
    commitment: input.commitment,
    stateDigest: input.stateDigest,
    observedAt,
    validUntil,
    projectionCreatorPubkey: input.projectionCreatorPubkey,
    unresolvedOwnerTransferCount: input.unresolvedOwnerTransferCount,
  };
  const authoritySourceRef = [
    input.network,
    input.programId,
    input.circleAccountRef,
    String(input.observedSlot),
  ].join(':');
  return deepFreeze({
    proof,
    authoritySourceRef,
    authoritySourceVersion: input.programVersionRef,
    proofDigest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_CIRCLE_OWNER_PROOF_DOMAIN,
      proof,
    ),
    selectorDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.bootstrap-circle-owner-selector',
      {
        circleAccountRef: input.circleAccountRef,
        circleId: input.circleId,
        homeIdentityBindingId: input.homeIdentityBindingId,
      },
    ),
    capabilityDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.bootstrap-circle-owner-capability',
      {
        actorPubkey: input.actorPubkey,
        authoritySourceType: 'circle_chain_owner',
        circleAccountRef: input.circleAccountRef,
      },
    ),
    liveConfigDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.bootstrap-circle-owner-live-config',
      {
        network: input.network,
        programId: input.programId,
        programIdlDigest: input.programIdlDigest,
        programVersionRef: input.programVersionRef,
      },
    ),
  });
}

function assertOpeningConfig(config: GovernanceBootstrapCeremonyConfig): void {
  if ((config as { chainId?: string })?.chainId !== GOVERNANCE_BOOTSTRAP_CEREMONY_CHAIN_ID
    && (config as { chainId?: string })?.chainId !== GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID) {
    throw new Error('unsupported_governance_bootstrap_chain_id');
  }
}

function requireCanonicalText(value: string, errorCode: string): string {
  if (!value || !value.trim() || value !== value.trim()) {
    throw new Error(errorCode);
  }
  return value;
}

function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function requireCanonicalIsoDate(value: string, errorCode: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(errorCode);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function assertExactFields(
  value: object,
  allowedFields: Set<string>,
  errorCode: string,
): void {
  const fields = Object.keys(value);
  if (
    fields.length !== allowedFields.size
    || fields.some((field) => !allowedFields.has(field))
  ) {
    throw new Error(errorCode);
  }
}
