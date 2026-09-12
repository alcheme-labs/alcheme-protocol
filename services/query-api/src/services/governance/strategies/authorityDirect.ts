import type { GovernanceActorContext, GovernanceStrategyResult } from "./types";
import { canonicalSolanaPublicKeyString } from "../../identity/solanaPublicKey";

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
  const actorRole = normalizeRole(input.actor.role);
  const actorPubkey = input.actor.pubkey == null
    ? null
    : canonicalSolanaPublicKeyString(input.actor.pubkey);
  if (input.actor.pubkey != null && !actorPubkey) {
    throw new Error("invalid_governance_actor_pubkey");
  }
  const roles = new Set((input.config.authorized?.roles ?? []).map(normalizeRole));
  const pubkeys = new Set((input.config.authorized?.pubkeys ?? []).map((pubkey) => {
    const canonical = canonicalSolanaPublicKeyString(pubkey);
    if (!canonical) throw new Error("invalid_governance_authorized_pubkey");
    return canonical;
  }));

  if (actorRole && roles.has(actorRole)) {
    return { state: "accepted", reason: "authority_role_allowed" };
  }
  if (actorPubkey && pubkeys.has(actorPubkey)) {
    return { state: "accepted", reason: "authority_pubkey_allowed" };
  }

  return { state: "rejected", reason: "authority_role_denied" };
}

function normalizeRole(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
