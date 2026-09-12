import { assertNoAlchemeLiabilityWording } from "./riskDisclaimer";

export const EXTERNAL_APP_BOND_DISPOSITION_STATUSES = [
  "unlocked",
  "locked_for_case",
  "released",
  "forfeited",
  "routed_by_policy",
  "paused",
] as const;

export type ExternalAppBondDispositionStatus =
  (typeof EXTERNAL_APP_BOND_DISPOSITION_STATUSES)[number];

export const EXTERNAL_APP_RELATED_PARTY_ROLES = [
  "owner",
  "team",
  "affiliate",
  "sponsor",
  "paid_promoter",
  "node_operator",
  "reviewer",
  "competitor",
] as const;

export type ExternalAppRelatedPartyRole =
  (typeof EXTERNAL_APP_RELATED_PARTY_ROLES)[number];

const FORBIDDEN_ACTION_TOKENS = [
  "compensation",
  "payout",
  "insurance",
  "guarantee",
  "refund",
  "principal_protection",
  "principal protection",
  "make_whole",
  "make whole",
  "platform_liability",
  "platform liability",
  "loss_coverage",
  "loss coverage",
];

export interface ExternalAppBondDispositionPolicyProjection {
  policyEpochId: string;
  policyId: string;
  policyDigest: string;
  mint: string;
  maxCaseAmountRaw: string;
  status: "active" | "paused" | "retired";
  paused?: boolean;
}

export interface ExternalAppBondDispositionCaseProjection {
  id: string;
  externalAppId: string;
  policyEpochId: string;
  appIdHash: string;
  caseId: string;
  policyId: string;
  initiatorPubkey: string;
  mint: string;
  requestedAmountRaw: string;
  lockedAmountRaw: string;
  routedAmountRaw: string;
  evidenceHash: string;
  rulingDigest: string | null;
  status: ExternalAppBondDispositionStatus;
  relatedPartyRoles: ExternalAppRelatedPartyRole[];
}

export function assertBondDispositionCopyAllowed(copy: string): void {
  assertNoAlchemeLiabilityWording(copy);
  const normalized = copy.toLowerCase();
  if (FORBIDDEN_ACTION_TOKENS.some((token) => normalized.includes(token))) {
    throw new Error("external_app_bond_disposition_forbidden_wording");
  }
}

export function assertBondDispositionActionNameAllowed(actionName: string): void {
  assertBondDispositionCopyAllowed(actionName.replace(/[_-]/g, " "));
}

export function buildBondDispositionCaseProjection(input: {
  id?: string;
  externalAppId: string;
  policyEpochId: string;
  appIdHash: string;
  caseId: string;
  policyId: string;
  initiatorPubkey: string;
  mint: string;
  requestedAmountRaw: string | number;
  lockedAmountRaw?: string | number | null;
  routedAmountRaw?: string | number | null;
  evidenceHash: string;
  rulingDigest?: string | null;
  status?: ExternalAppBondDispositionStatus;
  relatedPartyRoles?: string[] | null;
}): ExternalAppBondDispositionCaseProjection {
  const relatedPartyRoles = normalizeRelatedPartyRoles(input.relatedPartyRoles ?? []);
  return {
    id: input.id ?? `${input.externalAppId}:${input.caseId}`,
    externalAppId: input.externalAppId,
    policyEpochId: input.policyEpochId,
    appIdHash: input.appIdHash,
    caseId: input.caseId,
    policyId: input.policyId,
    initiatorPubkey: input.initiatorPubkey,
    mint: input.mint,
    requestedAmountRaw: normalizeRaw(input.requestedAmountRaw),
    lockedAmountRaw: normalizeRaw(input.lockedAmountRaw ?? "0"),
    routedAmountRaw: normalizeRaw(input.routedAmountRaw ?? "0"),
    evidenceHash: input.evidenceHash,
    rulingDigest: input.rulingDigest ?? null,
    status: input.status ?? "unlocked",
    relatedPartyRoles,
  };
}

export function assertBondDispositionRequestAllowed(input: {
  policy: ExternalAppBondDispositionPolicyProjection;
  requestedAmountRaw: string | number;
  riskDisclaimerAccepted: boolean;
  evidenceAvailable: boolean;
  actionName?: string;
}): void {
  if (input.actionName) assertBondDispositionActionNameAllowed(input.actionName);
  if (!input.riskDisclaimerAccepted) {
    throw new Error("external_app_risk_disclaimer_required");
  }
  if (!input.evidenceAvailable) {
    throw new Error("external_app_bond_disposition_evidence_required");
  }
  if (input.policy.paused || input.policy.status !== "active") {
    throw new Error("external_app_bond_disposition_policy_not_active");
  }
  if (BigInt(normalizeRaw(input.requestedAmountRaw)) > BigInt(normalizeRaw(input.policy.maxCaseAmountRaw))) {
    throw new Error("external_app_bond_disposition_amount_exceeds_policy");
  }
}

export function summarizeBondDispositionState(input: {
  cases?: Array<{ status: string; lockedAmountRaw?: string | number | null; routedAmountRaw?: string | number | null }>;
  riskDisclaimerAccepted?: boolean;
}) {
  const cases = input.cases ?? [];
  const activeCases = cases.filter((entry) =>
    ["locked_for_case", "forfeited"].includes(entry.status),
  );
  return {
    state: deriveDispositionState(cases),
    activeLockedAmountRaw: sumRaw(activeCases.map((entry) => entry.lockedAmountRaw ?? "0")),
    totalRoutedAmountRaw: sumRaw(cases.map((entry) => entry.routedAmountRaw ?? "0")),
    activeCaseCount: activeCases.length,
    riskDisclaimerAccepted: Boolean(input.riskDisclaimerAccepted),
    riskDisclaimerRequired: true,
  };
}

function deriveDispositionState(cases: Array<{ status: string }>) {
  if (cases.some((entry) => entry.status === "paused")) return "paused";
  if (cases.some((entry) => entry.status === "forfeited")) return "forfeited";
  if (cases.some((entry) => entry.status === "locked_for_case")) return "locked_for_case";
  if (cases.some((entry) => entry.status === "routed_by_policy")) return "routed_by_policy";
  if (cases.some((entry) => entry.status === "released")) return "released";
  return "none";
}

function normalizeRelatedPartyRoles(values: string[]): ExternalAppRelatedPartyRole[] {
  return values.filter((value): value is ExternalAppRelatedPartyRole =>
    (EXTERNAL_APP_RELATED_PARTY_ROLES as readonly string[]).includes(value),
  );
}

function sumRaw(values: Array<string | number | null | undefined>): string {
  return values.reduce((sum, value) => sum + BigInt(normalizeRaw(value ?? "0")), 0n).toString();
}

function normalizeRaw(value: string | number | null | undefined): string {
  const normalized = String(value ?? "0").trim();
  return /^[0-9]+$/.test(normalized) ? normalized : "0";
}
