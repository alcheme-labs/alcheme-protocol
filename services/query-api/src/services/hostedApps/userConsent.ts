import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";
import type { HostedAppCapabilityUserConsent } from "./capabilityCatalog";

export type HostedAppUserConsentDecision = "allowed" | "denied" | "revoked";

export function buildUserConsentReceipt(input: {
  appId: string;
  circleId: number;
  userPubkey: string;
  capabilityId: string;
  personalDataScope: string[];
  decision: HostedAppUserConsentDecision;
  expiresAt: string | null;
}) {
  const base = {
    receiptId: randomUUID(),
    consentType: "user_consent",
    ...input,
    issuedAt: new Date().toISOString(),
  };
  return { ...base, receiptDigest: digestJson(base) };
}

export function assertUserConsentAllowsCapability(input: {
  capabilityId: string;
  requiredUserConsent: HostedAppCapabilityUserConsent;
  consentReceipt?: { capabilityId: string; decision: string; expiresAt?: string | null } | null;
}): void {
  if (input.requiredUserConsent === "none") return;
  if (!input.consentReceipt || input.consentReceipt.capabilityId !== input.capabilityId) {
    throw new Error("hosted_app_user_consent_required");
  }
  if (input.consentReceipt.decision !== "allowed") {
    throw new Error("hosted_app_user_consent_denied");
  }
  if (input.consentReceipt.expiresAt && Date.parse(input.consentReceipt.expiresAt) <= Date.now()) {
    throw new Error("hosted_app_user_consent_expired");
  }
}
