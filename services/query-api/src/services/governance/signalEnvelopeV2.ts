import {
  canonicalGovernanceJson,
  hashCanonicalGovernanceValue,
} from './canonicalCodec';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';

export const GOVERNANCE_SIGNAL_ENVELOPE_VERSION = 2 as const;
export const GOVERNANCE_SIGNAL_ENVELOPE_DOMAIN = 'alcheme.governance.signal' as const;
export const GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS = 300 as const;

export type GovernanceSignalChainId = 'solana:localnet' | 'solana:devnet';

export interface GovernanceSignalEnvelopeConfig {
  chainId: GovernanceSignalChainId;
  ttlSeconds: typeof GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS;
}

export interface GovernanceSignalEnvelopeRequestFacts {
  id: string;
  actionType: string;
  targetType: string;
  targetRef: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  policyRules: unknown;
  snapshotDigest: string;
  executionMode: 'legacy_action_checkpoint' | 'stage_decision_only' | 'provider_bound_action' | null;
  caseRef: string | null;
  stageRef: string | null;
  compatibilityBundleVersion: string | null;
  executionModeDigest: string | null;
}

export type GovernanceSignedSignal = {
  kind: 'single_choice';
  choice: 'approve' | 'reject' | 'abstain';
} | {
  kind: 'quadratic_voice_credits';
  choiceVector: Array<{ choiceId: string; votes: number }>;
  creditBudget: number;
  cost: number;
  mechanismContractDigest: string;
} | {
  kind: 'quadratic_funding';
  commitments: Array<{ projectId: string; amount: number }>;
  budgetUnit: string;
  totalCommitment: number;
  mechanismContractDigest: string;
};

export interface GovernanceSignalEnvelopeV2 {
  v: typeof GOVERNANCE_SIGNAL_ENVELOPE_VERSION;
  domain: typeof GOVERNANCE_SIGNAL_ENVELOPE_DOMAIN;
  network: GovernanceSignalChainId;
  caseId: string | null;
  requestId: string;
  actionType: string;
  subjectType: string;
  subjectRef: string;
  actor: string;
  signal: GovernanceSignedSignal;
  payloadDigest: string;
  policyDigest: string;
  snapshotDigest: string;
  executionMode: 'legacy_action_checkpoint' | 'stage_decision_only' | 'provider_bound_action' | null;
  caseRef: string | null;
  stageRef: string | null;
  compatibilityBundleVersion: string | null;
  executionModeDigest: string | null;
  nonce: string;
  expiresAt: string;
}

export interface PreparedGovernanceSignalEnvelopeV2 {
  envelope: GovernanceSignalEnvelopeV2;
  signedMessage: string;
  envelopeDigest: string;
}

export function resolveGovernanceSignalEnvelopeConfig(
  env: Record<string, string | undefined> = process.env,
): GovernanceSignalEnvelopeConfig {
  const rawChainId = env.GOVERNANCE_SIGNAL_CHAIN_ID?.trim();
  if (!rawChainId) {
    throw new Error('governance_signal_chain_id_required');
  }
  if (rawChainId !== 'solana:localnet' && rawChainId !== 'solana:devnet') {
    throw new Error('unsupported_governance_signal_chain_id');
  }
  const rawTtl = env.GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS?.trim();
  if (!rawTtl) {
    throw new Error('governance_signal_envelope_ttl_required');
  }
  const ttlSeconds = Number(rawTtl);
  if (ttlSeconds !== GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS) {
    throw new Error('unsupported_governance_signal_envelope_ttl');
  }
  return { chainId: rawChainId, ttlSeconds };
}

export function resolveGovernanceSignalEnvelopeConfigForRequest(
  request: Pick<GovernanceSignalEnvelopeRequestFacts, 'executionMode' | 'payload'>,
  env: Record<string, string | undefined> = process.env,
): GovernanceSignalEnvelopeConfig {
  if (request.executionMode !== 'provider_bound_action') {
    return resolveGovernanceSignalEnvelopeConfig(env);
  }
  const chainId = request.payload?.chainId;
  if (chainId !== 'solana:localnet' && chainId !== 'solana:devnet') {
    throw new Error('governance_signal_provider_chain_id_required');
  }
  const rawTtl = env.GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS?.trim();
  if (!rawTtl) {
    throw new Error('governance_signal_envelope_ttl_required');
  }
  const ttlSeconds = Number(rawTtl);
  if (ttlSeconds !== GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS) {
    throw new Error('unsupported_governance_signal_envelope_ttl');
  }
  return { chainId, ttlSeconds };
}

export function prepareGovernanceSignalEnvelopeV2(input: {
  config: GovernanceSignalEnvelopeConfig;
  request: GovernanceSignalEnvelopeRequestFacts;
  actorPubkey: string;
  signal: GovernanceSignedSignal;
  nonce: string;
  now: Date;
}): PreparedGovernanceSignalEnvelopeV2 {
  assertConfig(input.config);
  const expiresAt = new Date(
    input.now.getTime() + input.config.ttlSeconds * 1_000,
  ).toISOString();
  return buildPreparedEnvelope({ ...input, expiresAt });
}

export function verifyGovernanceSignalEnvelopeV2(input: {
  config: GovernanceSignalEnvelopeConfig;
  request: GovernanceSignalEnvelopeRequestFacts;
  actorPubkey: string;
  signal: GovernanceSignedSignal;
  nonce: string;
  expiresAt: string;
  signedMessage: string;
  now: Date;
}): PreparedGovernanceSignalEnvelopeV2 {
  assertConfig(input.config);
  if (!input.signedMessage.includes(`"domain":"${GOVERNANCE_SIGNAL_ENVELOPE_DOMAIN}"`)) {
    throw new Error('governance_signal_envelope_domain_mismatch');
  }
  if (!input.signedMessage.includes(`"network":"${input.config.chainId}"`)) {
    throw new Error('governance_signal_envelope_network_mismatch');
  }
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error('invalid_governance_signal_envelope_expiry');
  }
  if (expiresAtMs <= input.now.getTime()) {
    throw new Error('governance_signal_envelope_expired');
  }
  if (expiresAtMs > input.now.getTime() + input.config.ttlSeconds * 1_000) {
    throw new Error('governance_signal_envelope_future_expiry');
  }
  const prepared = buildPreparedEnvelope(input);
  if (input.signedMessage !== prepared.signedMessage) {
    throw new Error('governance_signal_signature_payload_mismatch');
  }
  return prepared;
}

function buildPreparedEnvelope(input: {
  config: GovernanceSignalEnvelopeConfig;
  request: GovernanceSignalEnvelopeRequestFacts;
  actorPubkey: string;
  signal: GovernanceSignedSignal;
  nonce: string;
  expiresAt: string;
}): PreparedGovernanceSignalEnvelopeV2 {
  const actor = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actor) throw new Error('invalid_governance_signal_actor_pubkey');
  const nonce = input.nonce.trim();
  if (!nonce || nonce.length > 128) {
    throw new Error('invalid_governance_signal_wallet_nonce');
  }
  const modeFacts = normalizeExecutionModeFacts(input.request);
  const payloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.signal.payload',
    {
      actionType: input.request.actionType,
      idempotencyKey: input.request.idempotencyKey,
      payload: canonicalSignalValue(input.request.payload),
      targetRef: input.request.targetRef,
      targetType: input.request.targetType,
      valueEncoding: 'alcheme-typed-json-v1',
    },
  );
  const policyDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.signal.policy',
    {
      policyId: input.request.policyId,
      policyVersion: input.request.policyVersion,
      policyVersionId: input.request.policyVersionId,
      ruleId: input.request.ruleId,
      rules: canonicalSignalValue(input.request.policyRules),
      ...modeFacts,
      valueEncoding: 'alcheme-typed-json-v1',
    },
  );
  const envelope: GovernanceSignalEnvelopeV2 = {
    v: GOVERNANCE_SIGNAL_ENVELOPE_VERSION,
    domain: GOVERNANCE_SIGNAL_ENVELOPE_DOMAIN,
    network: input.config.chainId,
    caseId: modeFacts.caseRef,
    requestId: input.request.id,
    actionType: input.request.actionType,
    subjectType: input.request.targetType,
    subjectRef: input.request.targetRef,
    actor,
    signal: normalizeSignedSignal(input.signal),
    payloadDigest,
    policyDigest,
    snapshotDigest: requireDigest(input.request.snapshotDigest),
    ...modeFacts,
    nonce,
    expiresAt: input.expiresAt,
  };
  const canonical = canonicalGovernanceJson(
    GOVERNANCE_SIGNAL_ENVELOPE_DOMAIN,
    envelope,
  );
  return {
    envelope,
    signedMessage: `alcheme-governance-signal-v2:${canonical}`,
    envelopeDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.signal.envelope',
      envelope,
    ),
  };
}

function normalizeSignedSignal(signal: GovernanceSignedSignal): GovernanceSignedSignal {
  if (signal.kind === 'single_choice') {
    if (signal.choice !== 'approve' && signal.choice !== 'reject' && signal.choice !== 'abstain') {
      throw new Error('governance_signal_choice_unsupported');
    }
    return { kind: 'single_choice', choice: signal.choice };
  }
  if (signal.kind === 'quadratic_funding') {
    return {
      kind: 'quadratic_funding',
      commitments: signal.commitments.map((commitment) => ({
        projectId: requiredSignalText(commitment.projectId),
        amount: requiredSignalInteger(commitment.amount),
      })),
      budgetUnit: requiredSignalText(signal.budgetUnit),
      totalCommitment: requiredSignalInteger(signal.totalCommitment),
      mechanismContractDigest: requireDigest(signal.mechanismContractDigest),
    };
  }
  if (signal.kind !== 'quadratic_voice_credits') {
    throw new Error('governance_signal_kind_unsupported');
  }
  return {
    kind: 'quadratic_voice_credits',
    choiceVector: signal.choiceVector.map((choice) => ({
      choiceId: requiredSignalText(choice.choiceId),
      votes: requiredSignalInteger(choice.votes),
    })),
    creditBudget: requiredSignalInteger(signal.creditBudget),
    cost: requiredSignalInteger(signal.cost),
    mechanismContractDigest: requireDigest(signal.mechanismContractDigest),
  };
}

function requiredSignalText(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 128) {
    throw new Error('invalid_governance_signal_payload');
  }
  return normalized;
}

function requiredSignalInteger(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error('invalid_governance_signal_payload');
  }
  return normalized;
}

function normalizeExecutionModeFacts(
  request: GovernanceSignalEnvelopeRequestFacts,
): Pick<
  GovernanceSignalEnvelopeV2,
  | 'executionMode'
  | 'caseRef'
  | 'stageRef'
  | 'compatibilityBundleVersion'
  | 'executionModeDigest'
> {
  const facts = {
    executionMode: request.executionMode ?? null,
    caseRef: request.caseRef ?? null,
    stageRef: request.stageRef ?? null,
    compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
    executionModeDigest: request.executionModeDigest ?? null,
  };
  if (facts.executionMode === null) {
    if (
      facts.caseRef !== null
      || facts.stageRef !== null
      || facts.compatibilityBundleVersion !== null
      || facts.executionModeDigest !== null
    ) {
      throw new Error('incomplete_governance_signal_execution_mode_facts');
    }
    return facts;
  }
  if (
    facts.executionMode !== 'legacy_action_checkpoint'
    && facts.executionMode !== 'stage_decision_only'
    && facts.executionMode !== 'provider_bound_action'
  ) {
    throw new Error('invalid_governance_signal_execution_mode');
  }
  if (!facts.executionModeDigest || !/^[a-f0-9]{64}$/.test(facts.executionModeDigest)) {
    throw new Error('invalid_governance_signal_execution_mode_digest');
  }
  if (facts.executionMode === 'legacy_action_checkpoint') {
    if (!facts.compatibilityBundleVersion?.trim()) {
      throw new Error('governance_signal_compatibility_bundle_version_required');
    }
    if (facts.caseRef !== null || facts.stageRef !== null) {
      throw new Error('legacy_governance_signal_case_stage_forbidden');
    }
  } else {
    if (!facts.caseRef?.trim() || !facts.stageRef?.trim()) {
      throw new Error('stage_governance_signal_case_stage_required');
    }
    if (facts.compatibilityBundleVersion !== null) {
      throw new Error('stage_governance_signal_compatibility_bundle_forbidden');
    }
  }
  return facts;
}

function assertConfig(config: GovernanceSignalEnvelopeConfig): void {
  if (config.chainId !== 'solana:localnet' && config.chainId !== 'solana:devnet') {
    throw new Error('unsupported_governance_signal_chain_id');
  }
  if (config.ttlSeconds !== GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS) {
    throw new Error('unsupported_governance_signal_envelope_ttl');
  }
}

function requireDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('invalid_governance_signal_snapshot_digest');
  }
  return value;
}

function canonicalSignalValue(value: unknown): unknown {
  if (value === null) return ['null'];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error('unsupported_governance_signal_digest_value');
    }
    return Number.isSafeInteger(value)
      ? ['integer', value]
      : ['decimal', JSON.stringify(value)];
  }
  if (Array.isArray(value)) {
    return ['array', value.map(canonicalSignalValue)];
  }
  if (!value || typeof value !== 'object') {
    throw new Error('unsupported_governance_signal_digest_value');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('unsupported_governance_signal_digest_value');
  }
  const record = value as Record<string, unknown>;
  return [
    'object',
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalSignalValue(record[key])]),
  ];
}
