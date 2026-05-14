export type ExternalNodeType = "app_owned" | "community" | "private_sidecar";
export type ExternalNodePolicyStatus = "normal" | "restricted" | "denied";

const NODE_TYPES = new Set<ExternalNodeType>([
  "app_owned",
  "community",
  "private_sidecar",
]);
const POLICY_STATUSES = new Set<ExternalNodePolicyStatus>([
  "normal",
  "restricted",
  "denied",
]);

export function normalizeExternalNodeType(value: unknown): ExternalNodeType {
  const normalized = String(value || "").trim().toLowerCase() as ExternalNodeType;
  if (!NODE_TYPES.has(normalized)) {
    throw new Error("invalid_external_node_type");
  }
  return normalized;
}

export function normalizeExternalNodePolicyStatus(
  value: unknown,
): ExternalNodePolicyStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase() as ExternalNodePolicyStatus;
  if (!POLICY_STATUSES.has(normalized)) {
    throw new Error("invalid_external_node_policy_status");
  }
  return normalized;
}
