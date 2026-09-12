export type HostedAppTrustState =
  | "active"
  | "pending_reconfirm"
  | "limited"
  | "suspended"
  | "blocked";

export type HostedAppReleaseStatus =
  | "candidate"
  | "preview"
  | "production"
  | "deprecated"
  | "revoked";

export type HostedAppCapabilityKind =
  | "read"
  | "action"
  | "signature"
  | "storage"
  | "event";

export type HostedAppDecision =
  | "allowed"
  | "denied"
  | "partially_allowed"
  | "expired"
  | "revoked";

export type HostedAppActionDecision =
  | "executed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "denied"
  | "failed";
