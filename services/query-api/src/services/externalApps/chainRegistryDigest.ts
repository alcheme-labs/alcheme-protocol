import { createHash } from "node:crypto";

import { normalizeExternalAppId } from "./validation";

function stableSortValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(stableSortValue);
  }
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const value = record[key];
      if (value !== undefined) {
        sorted[key] = stableSortValue(value);
      }
    }
    return sorted;
  }
  return input;
}

function stableStringify(input: unknown): string {
  return JSON.stringify(stableSortValue(input));
}

export function sha256Bytes32(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeHash32Hex(value: string, label: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`invalid_${label}`);
  }
  return normalized;
}

export function manifestHashToBytes32Hex(manifestHash: string): string {
  const normalized = String(manifestHash || "").trim().toLowerCase();
  if (!normalized.startsWith("sha256:")) {
    throw new Error("external_app_registry_manifest_hash_must_be_sha256");
  }
  return normalizeHash32Hex(
    normalized.slice("sha256:".length),
    "external_app_registry_manifest_hash",
  );
}

export function appIdHash(appId: string): string {
  return sha256Bytes32(`alcheme:external-app:v2:${normalizeExternalAppId(appId)}`);
}

export function serverKeyHash(serverPublicKey: string): string {
  return sha256Bytes32(
    stableStringify({
      domain: "alcheme:external-app-server-key:v2",
      serverPublicKey: String(serverPublicKey || "").trim(),
    }),
  );
}

export function ownerAssertionHash(payload: string, signature: string): string {
  return sha256Bytes32(
    stableStringify({
      domain: "alcheme:external-app-owner-assertion:v2",
      payload: String(payload || ""),
      signature: String(signature || "").trim(),
    }),
  );
}

export function policyStateDigest(input: Record<string, unknown>): string {
  return sha256Bytes32(
    stableStringify({
      domain: "alcheme:external-app-policy-state:v2",
      input,
    }),
  );
}

export function externalAppExecutionIntentDigest(input: Record<string, unknown>): string {
  return sha256Bytes32(
    stableStringify({
      domain: "alcheme:external-app-execution-intent:v2",
      input,
    }),
  );
}

export function governanceExecutionReceiptDigest(input: Record<string, unknown>): string {
  return sha256Bytes32(
    stableStringify({
      domain: "alcheme:external-app-governance-execution-receipt:v2",
      input,
    }),
  );
}
