export type ExternalAppEnvironment =
  | "sandbox"
  | "devnet_reviewed"
  | "mainnet_production"
  | "high_trust";

export type ExternalAppRegistryStatus =
  | "pending"
  | "active"
  | "disputed"
  | "suspended"
  | "revoked";

export type ExternalAppDiscoveryStatus =
  | "unlisted"
  | "listed"
  | "limited"
  | "hidden"
  | "delisted";

export type ManagedNodePolicy =
  | "normal"
  | "throttled"
  | "restricted"
  | "emergency_hold"
  | "denied";

export type CapabilityPolicy =
  | "normal"
  | "limited"
  | "disabled_on_managed_node";

export interface ExternalAppPolicyState {
  environment: ExternalAppEnvironment;
  registryStatus: ExternalAppRegistryStatus;
  discoveryStatus: ExternalAppDiscoveryStatus;
  managedNodePolicy: ManagedNodePolicy;
  capabilityPolicies: Record<string, CapabilityPolicy>;
}
