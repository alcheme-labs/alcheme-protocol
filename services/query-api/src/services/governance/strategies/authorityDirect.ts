import type { GovernanceActorContext, GovernanceStrategyResult } from "./types";

export interface AuthorityDirectConfig {
  strategy: "authority.direct";
  authorized?: {
    roles?: string[];
    pubkeys?: string[];
  };
}

export function evaluateAuthorityDirect(input: {
  config: AuthorityDirectConfig;
  actor: GovernanceActorContext;
}): GovernanceStrategyResult {
  const actorRole = normalize(input.actor.role);
  const actorPubkey = normalize(input.actor.pubkey);
  const roles = new Set((input.config.authorized?.roles ?? []).map(normalize));
  const pubkeys = new Set(
    (input.config.authorized?.pubkeys ?? []).map(normalize),
  );

  if (actorRole && roles.has(actorRole)) {
    return { state: "accepted", reason: "authority_role_allowed" };
  }
  if (actorPubkey && pubkeys.has(actorPubkey)) {
    return { state: "accepted", reason: "authority_pubkey_allowed" };
  }

  return { state: "rejected", reason: "authority_role_denied" };
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
