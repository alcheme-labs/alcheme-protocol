import { createHash } from "node:crypto";

export const GOVERNANCE_CANONICAL_CODEC_VERSION = 1 as const;

export function canonicalGovernanceJson(
  domain: string,
  payload: unknown,
): string {
  const normalizedDomain = normalizeDomain(domain);
  return canonicalJson({
    domain: normalizedDomain,
    payload,
    version: GOVERNANCE_CANONICAL_CODEC_VERSION,
  });
}

export function hashCanonicalGovernanceValue(
  domain: string,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(canonicalGovernanceJson(domain, payload), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (
      !Number.isSafeInteger(value)
      || Object.is(value, -0)
    ) {
      throw unsupportedValue();
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    throw unsupportedValue();
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeDomain(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error("invalid_canonical_governance_domain");
  }
  return normalized;
}

function unsupportedValue(): Error {
  return new Error("unsupported_canonical_governance_value");
}
