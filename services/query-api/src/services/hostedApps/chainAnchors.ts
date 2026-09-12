export type HostedAppChainAnchorRequirement =
  | "required_for_high_value"
  | "recommended_commitment"
  | "forbidden_raw";

const REQUIRED_FOR_HIGH_VALUE = new Set([
  "governance_decision",
  "high_value_credential",
  "external_execution",
  "production_promotion",
  "economic_state",
]);

const RECOMMENDED_COMMITMENTS = new Set([
  "app_identity",
  "owner_identity",
  "operator_identity",
  "manifest_hash",
  "release_id",
  "bundle_hash",
  "stable_channel_movement",
  "lts_channel_movement",
  "server_key_hash",
  "capability_policy_digest",
  "production_status",
  "app_capability_deny",
  "issuer_digest",
  "issuer_change_digest",
  "schema_digest",
  "schema_change_digest",
  "revocation_feed_digest",
  "offline_verification_bundle_digest",
  "capability_change_digest",
  "scope_authority_lifecycle_digest",
  "scope_authority_change_digest",
]);

const FORBIDDEN_RAW = new Set([
  "user_consent_details",
  "runtime_session",
  "capability_query_log",
  "private_circle_data",
  "private_evidence",
  "risk_report_raw_text",
  "preview_audience_details",
  "canary_audience_details",
]);

export function classifyChainAnchorRequirement(kind: string): HostedAppChainAnchorRequirement {
  const normalized = String(kind || "").trim().toLowerCase();
  if (FORBIDDEN_RAW.has(normalized)) return "forbidden_raw";
  if (REQUIRED_FOR_HIGH_VALUE.has(normalized)) return "required_for_high_value";
  if (RECOMMENDED_COMMITMENTS.has(normalized)) return "recommended_commitment";
  return "forbidden_raw";
}
