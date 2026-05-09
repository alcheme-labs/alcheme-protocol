export type GovernanceStrategyState = "accepted" | "rejected" | "active";

export interface GovernanceStrategyResult {
  state: GovernanceStrategyState;
  reason: string;
  requestId?: string;
  tally?: Record<string, unknown>;
}

export interface GovernanceActorContext {
  pubkey?: string | null;
  role?: string | null;
}

export interface GovernanceSignalInput {
  actorPubkey?: string | null;
  value: string;
}
