import type {
  CapabilityPolicy,
  ExternalAppDiscoveryStatus,
  ExternalAppEnvironment,
  ExternalAppRegistryStatus,
  ManagedNodePolicy,
} from "./types";

const VALID_EXTERNAL_APP_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

const ENVIRONMENTS = new Set<ExternalAppEnvironment>([
  "sandbox",
  "devnet_reviewed",
  "mainnet_production",
  "high_trust",
]);

const REGISTRY_STATUSES = new Set<ExternalAppRegistryStatus>([
  "pending",
  "active",
  "disputed",
  "suspended",
  "revoked",
]);

const DISCOVERY_STATUSES = new Set<ExternalAppDiscoveryStatus>([
  "unlisted",
  "listed",
  "limited",
  "hidden",
  "delisted",
]);

const MANAGED_NODE_POLICIES = new Set<ManagedNodePolicy>([
  "normal",
  "throttled",
  "restricted",
  "emergency_hold",
  "denied",
]);

const CAPABILITY_POLICIES = new Set<CapabilityPolicy>([
  "normal",
  "limited",
  "disabled_on_managed_node",
]);

export function normalizeExternalAppId(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!VALID_EXTERNAL_APP_ID.test(normalized)) {
    throw new Error("invalid_external_app_id");
  }
  return normalized;
}

export function normalizeExternalAppEnvironment(
  value: unknown,
): ExternalAppEnvironment {
  const normalized = String(value || "").trim().toLowerCase() as ExternalAppEnvironment;
  if (!ENVIRONMENTS.has(normalized)) {
    throw new Error("invalid_external_app_environment");
  }
  return normalized;
}

export function normalizeExternalAppRegistryStatus(
  value: unknown,
): ExternalAppRegistryStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase() as ExternalAppRegistryStatus;
  if (!REGISTRY_STATUSES.has(normalized)) {
    throw new Error("invalid_external_app_registry_status");
  }
  return normalized;
}

export function normalizeExternalAppDiscoveryStatus(
  value: unknown,
): ExternalAppDiscoveryStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase() as ExternalAppDiscoveryStatus;
  if (!DISCOVERY_STATUSES.has(normalized)) {
    throw new Error("invalid_external_app_discovery_status");
  }
  return normalized;
}

export function normalizeManagedNodePolicy(value: unknown): ManagedNodePolicy {
  const normalized = String(value || "").trim().toLowerCase() as ManagedNodePolicy;
  if (!MANAGED_NODE_POLICIES.has(normalized)) {
    throw new Error("invalid_managed_node_policy");
  }
  return normalized;
}

export function normalizeCapabilityPolicyMap(
  value: unknown,
): Record<string, CapabilityPolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, CapabilityPolicy> = {};
  for (const [rawKey, rawPolicy] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(key)) {
      throw new Error("invalid_capability_policy_key");
    }
    const policy = String(rawPolicy || "")
      .trim()
      .toLowerCase() as CapabilityPolicy;
    if (!CAPABILITY_POLICIES.has(policy)) {
      throw new Error("invalid_capability_policy_value");
    }
    result[key] = policy;
  }
  return result;
}

export function normalizeAllowedOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const origins = value.map((origin) => normalizeAllowedOrigin(origin));
  return [...new Set(origins)].sort();
}

export function normalizeAllowedOrigin(value: unknown): string {
  const raw = String(value || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid_external_app_origin");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_external_app_origin");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("invalid_external_app_origin");
  }
  return parsed.origin;
}
