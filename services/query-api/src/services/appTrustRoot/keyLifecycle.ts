export type AppTrustRootKeyLifecycleStatus =
  | "active"
  | "rotating"
  | "grace"
  | "revoked";

export type AppTrustRootKeyLifecycleDecisionCode =
  | "key_allowed"
  | "key_in_grace"
  | "key_unknown"
  | "key_duplicate"
  | "key_status_invalid"
  | "key_lifecycle_timestamp_invalid"
  | "key_revoked"
  | "key_not_yet_valid"
  | "key_expired";

export interface AppTrustRootKeyLifecycleRecord {
  keyId: string;
  publicKeyRef?: string | null;
  status: AppTrustRootKeyLifecycleStatus;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  graceUntil?: Date | string | null;
  revokedAt?: Date | string | null;
}

export interface AppTrustRootKeyLifecycleDecision {
  allowed: boolean;
  reasonCode: AppTrustRootKeyLifecycleDecisionCode;
  key: AppTrustRootKeyLifecycleRecord | null;
}

export function evaluateAppTrustRootKeyLifecycle(input: {
  keyId: string | null | undefined;
  keys: AppTrustRootKeyLifecycleRecord[];
  now?: Date;
}): AppTrustRootKeyLifecycleDecision {
  const normalizedKeyId = String(input.keyId || "").trim();
  if (!normalizedKeyId) {
    return denyKey("key_unknown", null);
  }
  const matches = input.keys.filter((candidate) => candidate.keyId === normalizedKeyId);
  if (matches.length === 0) {
    return denyKey("key_unknown", null);
  }
  if (matches.length > 1) {
    return denyKey("key_duplicate", matches[0]);
  }
  const key = matches[0];

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return denyKey("key_lifecycle_timestamp_invalid", key);
  }
  const validFrom = optionalTimeMs(key.validFrom);
  const validUntil = optionalTimeMs(key.validUntil);
  const graceUntil = optionalTimeMs(key.graceUntil);
  const revokedAt = optionalTimeMs(key.revokedAt);
  if (!validFrom.valid || !validUntil.valid || !graceUntil.valid || !revokedAt.valid) {
    return denyKey("key_lifecycle_timestamp_invalid", key);
  }

  switch (key.status) {
    case "active":
    case "rotating":
    case "grace":
    case "revoked":
      break;
    default:
      return denyKey("key_status_invalid", key);
  }

  if (validFrom.present && validFrom.timeMs > nowMs) {
    return denyKey("key_not_yet_valid", key);
  }

  if (key.status === "revoked" || revokedAt.present) {
    return denyKey("key_revoked", key);
  }

  if (validUntil.present && validUntil.timeMs <= nowMs) {
    if (key.status === "grace" && graceUntil.present && graceUntil.timeMs > nowMs) {
      return { allowed: true, reasonCode: "key_in_grace", key };
    }
    return denyKey("key_expired", key);
  }

  if (key.status === "grace") {
    if (!graceUntil.present || graceUntil.timeMs <= nowMs) {
      return denyKey("key_expired", key);
    }
    return { allowed: true, reasonCode: "key_in_grace", key };
  }

  return { allowed: true, reasonCode: "key_allowed", key };
}

function denyKey(
  reasonCode: Exclude<AppTrustRootKeyLifecycleDecisionCode, "key_allowed" | "key_in_grace">,
  key: AppTrustRootKeyLifecycleRecord | null,
): AppTrustRootKeyLifecycleDecision {
  return { allowed: false, reasonCode, key };
}

function optionalTimeMs(value: Date | string | null | undefined): {
  present: boolean;
  valid: boolean;
  timeMs: number;
} {
  if (value == null) return { present: false, valid: true, timeMs: 0 };
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return { present: true, valid: Number.isFinite(time), timeMs: time };
}
