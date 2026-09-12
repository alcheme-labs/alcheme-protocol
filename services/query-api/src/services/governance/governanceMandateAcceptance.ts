import { canonicalGovernanceJson, hashCanonicalGovernanceValue } from "./canonicalCodec";
import {
  GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS,
  type GovernanceSignalChainId,
} from "./signalEnvelopeV2";
import { canonicalSolanaPublicKeyString } from "../identity/solanaPublicKey";

export const GOVERNANCE_MANDATE_ACCEPTANCE_DOMAIN =
  "alcheme.governance.mandate.acceptance" as const;

export interface GovernanceMandateAcceptanceEnvelope {
  schemaVersion: 1;
  domain: typeof GOVERNANCE_MANDATE_ACCEPTANCE_DOMAIN;
  network: GovernanceSignalChainId;
  action: "accept_counter";
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  delegatorGovernanceHome: { type: string; ref: string };
  delegateAuthority: { type: string; ref: string };
  actor: string;
  nonce: string;
  expiresAt: string;
}

export function prepareGovernanceMandateAcceptance(input: {
  chainId: GovernanceSignalChainId;
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  delegatorGovernanceHome: { type: string; ref: string };
  delegateAuthority: { type: string; ref: string };
  actorPubkey: string;
  nonce: string;
  now: Date;
}): {
  envelope: GovernanceMandateAcceptanceEnvelope;
  signedMessage: string;
  envelopeDigest: string;
} {
  const expiresAt = new Date(
    input.now.getTime() + GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS * 1_000,
  ).toISOString();
  return buildGovernanceMandateAcceptance({ ...input, expiresAt });
}

export function verifyGovernanceMandateAcceptance(input: {
  chainId: GovernanceSignalChainId;
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  delegatorGovernanceHome: { type: string; ref: string };
  delegateAuthority: { type: string; ref: string };
  actorPubkey: string;
  nonce: string;
  expiresAt: string;
  signedMessage: string;
  now: Date;
}) {
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= input.now.getTime()) {
    throw new Error("governance_mandate_acceptance_expired");
  }
  if (
    expiresAtMs
    > input.now.getTime() + GOVERNANCE_SIGNAL_ENVELOPE_TTL_SECONDS * 1_000
  ) {
    throw new Error("governance_mandate_acceptance_future_expiry");
  }
  const prepared = buildGovernanceMandateAcceptance(input);
  if (prepared.signedMessage !== input.signedMessage) {
    throw new Error("governance_mandate_acceptance_payload_mismatch");
  }
  return prepared;
}

function buildGovernanceMandateAcceptance(input: {
  chainId: GovernanceSignalChainId;
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  delegatorGovernanceHome: { type: string; ref: string };
  delegateAuthority: { type: string; ref: string };
  actorPubkey: string;
  nonce: string;
  expiresAt: string;
}) {
  const actor = canonicalSolanaPublicKeyString(input.actorPubkey);
  const mandateId = requiredText(input.mandateId);
  const nonce = requiredText(input.nonce);
  if (!actor) throw new Error("invalid_governance_mandate_acceptance_actor");
  if (nonce.length > 128) throw new Error("invalid_governance_mandate_acceptance_nonce");
  if (!Number.isInteger(input.mandateVersion) || input.mandateVersion <= 0) {
    throw new Error("invalid_governance_mandate_version");
  }
  if (!/^[a-f0-9]{64}$/.test(input.mandateTermsDigest)) {
    throw new Error("invalid_governance_mandate_terms_digest");
  }
  const delegatorGovernanceHome = mandateRef(
    input.delegatorGovernanceHome,
    "invalid_governance_mandate_delegator_home",
  );
  const delegateAuthority = mandateRef(
    input.delegateAuthority,
    "invalid_governance_mandate_delegate_authority",
  );
  const envelope: GovernanceMandateAcceptanceEnvelope = {
    schemaVersion: 1,
    domain: GOVERNANCE_MANDATE_ACCEPTANCE_DOMAIN,
    network: input.chainId,
    action: "accept_counter",
    mandateId,
    mandateVersion: input.mandateVersion,
    mandateTermsDigest: input.mandateTermsDigest,
    delegatorGovernanceHome,
    delegateAuthority,
    actor,
    nonce,
    expiresAt: input.expiresAt,
  };
  const canonical = canonicalGovernanceJson(
    GOVERNANCE_MANDATE_ACCEPTANCE_DOMAIN,
    envelope,
  );
  return {
    envelope,
    signedMessage: `alcheme-governance-mandate-acceptance:${canonical}`,
    envelopeDigest: hashCanonicalGovernanceValue(
      GOVERNANCE_MANDATE_ACCEPTANCE_DOMAIN,
      envelope,
    ),
  };
}

function mandateRef(
  value: { type: string; ref: string },
  errorCode: string,
): { type: string; ref: string } {
  const type = String(value?.type ?? "").trim();
  const ref = String(value?.ref ?? "").trim();
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(type) || !ref || ref.length > 128 || ref !== value?.ref) {
    throw new Error(errorCode);
  }
  return { type, ref };
}

function requiredText(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new Error("invalid_governance_mandate_acceptance_text");
  }
  return normalized;
}
