import type { GovernanceSignalInput, GovernanceStrategyResult } from "./types";

export interface ConsentUnanimousConfig {
  strategy: "consent.unanimous";
  requiredParties: ReadonlyArray<string>;
}

export function evaluateConsentUnanimous(input: {
  config: ConsentUnanimousConfig;
  signals: GovernanceSignalInput[];
}): GovernanceStrategyResult {
  const required = input.config.requiredParties.map(normalize).filter(Boolean);
  const latestByActor = new Map<string, string>();
  for (const signal of input.signals) {
    const actor = normalize(signal.actorPubkey);
    if (actor) latestByActor.set(actor, normalize(signal.value));
  }

  for (const actor of required) {
    if (latestByActor.get(actor) === "reject") {
      return { state: "rejected", reason: "consent_rejected" };
    }
  }

  const allApproved = required.every(
    (actor) => latestByActor.get(actor) === "approve",
  );
  if (required.length > 0 && allApproved) {
    return {
      state: "accepted",
      reason: "unanimous_consent",
      tally: { required: required.length, approved: required.length },
    };
  }

  return {
    state: "active",
    reason: "consent_missing",
    tally: {
      required: required.length,
      approved: required.filter(
        (actor) => latestByActor.get(actor) === "approve",
      ).length,
    },
  };
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
