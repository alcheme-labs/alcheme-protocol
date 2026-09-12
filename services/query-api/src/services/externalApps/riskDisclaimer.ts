import { createHash, randomUUID } from "node:crypto";

const FORBIDDEN_WORDING = [
  "compensation",
  "compensate",
  "reimbursement",
  "reimburse",
  "insurance",
  "guarantee",
  "principal protection",
  "principal_protection",
  "refund",
  "make whole",
  "make-whole",
  "platform liability",
  "platform_liability",
];

export type ExternalAppRiskDisclaimerScope =
  | "developer_registration"
  | "external_app_entry"
  | "challenge_bond"
  | "bond_disposition";

export type ExternalAppRiskDisclaimerSource =
  | "wallet_signature"
  | "server_session"
  | "governance_receipt";

export interface ExternalAppRiskDisclaimerTerms {
  scope: ExternalAppRiskDisclaimerScope;
  disclaimerVersion: string;
  terms: string;
  termsDigest: string;
  onChainReceiptRequired: boolean;
}

export interface ExternalAppRiskDisclaimerAcceptanceInput {
  externalAppId: string;
  actorPubkey: string;
  scope: ExternalAppRiskDisclaimerScope;
  policyEpochId: string;
  disclaimerVersion: string;
  termsDigest: string;
  acceptanceDigest: string;
  source: ExternalAppRiskDisclaimerSource;
  signatureDigest?: string | null;
  chainReceiptPda?: string | null;
  chainReceiptDigest?: string | null;
  txSignature?: string | null;
  acceptedAt?: Date;
  metadata?: Record<string, unknown> | null;
}

const TERMS_BY_SCOPE: Record<ExternalAppRiskDisclaimerScope, { version: string; text: string }> = {
  developer_registration: {
    version: "external-app-developer-agreement-v1",
    text:
      "External app operators and participants accept their own app rules, risks, and consequences. " +
      "Alcheme provides protocol, SDK, discovery, evidence, governance, and rule-execution surfaces. " +
      "External app operators remain responsible for their app behavior, user promises, off-platform systems, and submitted manifests. " +
      "This acceptance records the developer's agreement to the active ExternalApp production-registration rules and no-liability boundary.",
  },
  external_app_entry: {
    version: "external-app-entry-risk-v1",
    text:
      "External app operators and participants accept their own app rules, risks, and consequences before entering the app. " +
      "Alcheme displays registry, review, projection, and evidence records without endorsing the app or operating the external app service.",
  },
  challenge_bond: {
    version: "external-app-challenge-bond-risk-v1",
    text:
      "A challenge bond is a participant-posted process bond. Challenge outcomes follow active policy, evidence, receipts, and governance records.",
  },
  bond_disposition: {
    version: "external-app-bond-disposition-risk-v1",
    text:
      "Bond disposition is rule execution under active policy and receipts. Posted bonds may be locked, released, forfeited, or routed only within the accepted policy scope.",
  },
};

export function assertNoAlchemeLiabilityWording(copy: string): void {
  const normalized = copy.toLowerCase();
  if (FORBIDDEN_WORDING.some((term) => normalized.includes(term))) {
    throw new Error("external_app_disclaimer_forbidden_liability_wording");
  }
}

export function buildRiskDisclaimerTerms(
  scope: ExternalAppRiskDisclaimerScope,
): ExternalAppRiskDisclaimerTerms {
  const template = TERMS_BY_SCOPE[scope];
  if (!template) throw new Error("external_app_risk_disclaimer_scope_invalid");
  const terms = template.text;
  return {
    scope,
    disclaimerVersion: template.version,
    terms,
    termsDigest: digestStable({
      domain: "alcheme:external-app-risk-disclaimer-terms:v1",
      scope,
      disclaimerVersion: template.version,
      terms,
    }),
    onChainReceiptRequired: true,
  };
}

export function computeRiskDisclaimerAcceptanceDigest(input: {
  externalAppId: string;
  actorPubkey: string;
  scope: ExternalAppRiskDisclaimerScope;
  policyEpochId: string;
  disclaimerVersion: string;
  termsDigest: string;
  bindingDigest?: string | null;
}): string {
  return digestStable({
    domain: "alcheme:external-app-risk-disclaimer-acceptance:v1",
    externalAppId: normalizeNonEmpty(input.externalAppId, "external_app_id"),
    actorPubkey: normalizeNonEmpty(input.actorPubkey, "actor_pubkey"),
    scope: input.scope,
    policyEpochId: normalizeNonEmpty(input.policyEpochId, "policy_epoch_id"),
    disclaimerVersion: normalizeNonEmpty(input.disclaimerVersion, "disclaimer_version"),
    termsDigest: normalizeRiskDigest(input.termsDigest, "terms_digest"),
    bindingDigest: input.bindingDigest ? normalizeRiskDigest(input.bindingDigest, "binding_digest") : null,
  });
}

export function assertRiskDisclaimerAcceptanceMatches(input: {
  externalAppId: string;
  actorPubkey: string;
  scope: ExternalAppRiskDisclaimerScope;
  policyEpochId: string;
  disclaimerVersion: string;
  termsDigest: string;
  acceptanceDigest: string;
  bindingDigest?: string | null;
  chainReceiptPda?: string | null;
  chainReceiptDigest?: string | null;
  txSignature?: string | null;
  requireChainReceipt?: boolean;
}): void {
  const terms = buildRiskDisclaimerTerms(input.scope);
  if (terms.disclaimerVersion !== input.disclaimerVersion) {
    throw new Error("external_app_risk_disclaimer_version_mismatch");
  }
  if (terms.termsDigest !== normalizeRiskDigest(input.termsDigest, "terms_digest")) {
    throw new Error("external_app_risk_disclaimer_terms_digest_mismatch");
  }
  const expectedAcceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
    externalAppId: input.externalAppId,
    actorPubkey: input.actorPubkey,
    scope: input.scope,
    policyEpochId: input.policyEpochId,
    disclaimerVersion: input.disclaimerVersion,
    termsDigest: input.termsDigest,
    bindingDigest: input.bindingDigest,
  });
  if (expectedAcceptanceDigest !== normalizeRiskDigest(input.acceptanceDigest, "acceptance_digest")) {
    throw new Error("external_app_risk_disclaimer_acceptance_digest_mismatch");
  }
  if (input.requireChainReceipt) {
    normalizeNonEmpty(input.chainReceiptPda, "chain_receipt_pda");
    normalizeHash32Hex(input.chainReceiptDigest, "chain_receipt_digest");
    normalizeNonEmpty(input.txSignature, "tx_signature");
  }
}

export function buildRiskDisclaimerAcceptance(input: {
  externalAppId: string;
  actorPubkey: string;
  scope: ExternalAppRiskDisclaimerScope;
  policyEpochId: string;
  disclaimerVersion: string;
  termsDigest: string;
  acceptanceDigest: string;
  source: ExternalAppRiskDisclaimerSource;
  signatureDigest?: string | null;
  chainReceiptPda?: string | null;
  chainReceiptDigest?: string | null;
  txSignature?: string | null;
  acceptedAt?: Date;
  metadata?: Record<string, unknown> | null;
}) {
  return {
    id: randomUUID(),
    externalAppId: input.externalAppId,
    actorPubkey: input.actorPubkey,
    scope: input.scope,
    policyEpochId: input.policyEpochId,
    disclaimerVersion: input.disclaimerVersion,
    termsDigest: normalizeRiskDigest(input.termsDigest, "terms_digest"),
    acceptanceDigest: normalizeRiskDigest(input.acceptanceDigest, "acceptance_digest"),
    source: input.source,
    signatureDigest: input.signatureDigest ?? null,
    chainReceiptPda: input.chainReceiptPda ?? null,
    chainReceiptDigest: input.chainReceiptDigest
      ? normalizeHash32Hex(input.chainReceiptDigest, "chain_receipt_digest")
      : null,
    txSignature: input.txSignature ?? null,
    acceptedAt: input.acceptedAt ?? new Date(),
    metadata: input.metadata ?? null,
  };
}

function digestStable(input: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(input)).digest("hex")}`;
}

function stableStringify(input: unknown): string {
  return JSON.stringify(stableSortValue(input));
}

function stableSortValue(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stableSortValue);
  if (input && typeof input === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) sorted[key] = stableSortValue(value);
    }
    return sorted;
  }
  return input;
}

function normalizeRiskDigest(value: unknown, label: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(normalized)) return normalized;
  if (/^[0-9a-f]{64}$/.test(normalized)) return `sha256:${normalized}`;
  throw new Error(`invalid_external_app_risk_disclaimer_${label}`);
}

function normalizeHash32Hex(value: unknown, label: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  const withoutPrefix = normalized.startsWith("sha256:")
    ? normalized.slice("sha256:".length)
    : normalized;
  if (!/^[0-9a-f]{64}$/.test(withoutPrefix)) {
    throw new Error(`invalid_external_app_risk_disclaimer_${label}`);
  }
  return withoutPrefix;
}

function normalizeNonEmpty(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`external_app_risk_disclaimer_${label}_required`);
  return normalized;
}
