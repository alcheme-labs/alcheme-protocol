import { createHash } from "node:crypto";

import { normalizeAllowedOrigins, normalizeExternalAppId } from "./validation";

export interface ExternalAppManifest {
  version: "1";
  appId: string;
  name: string;
  homeUrl: string;
  ownerWallet: string;
  serverPublicKey: string;
  allowedOrigins: string[];
  platforms?: Record<string, unknown>;
  capabilities: string[];
  callbacks?: Record<string, unknown>;
  policy?: Record<string, unknown>;
}

export function normalizeExternalAppManifest(raw: unknown): ExternalAppManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid_external_app_manifest");
  }
  const record = raw as Record<string, unknown>;
  let appId: string;
  try {
    appId = normalizeExternalAppId(record.appId);
  } catch {
    throw new Error("invalid_external_app_manifest");
  }
  let allowedOrigins: string[];
  try {
    allowedOrigins = normalizeAllowedOrigins(record.allowedOrigins);
  } catch {
    throw new Error("invalid_external_app_manifest");
  }
  if (allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("invalid_external_app_manifest");
  }
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((capability) => String(capability).trim()).filter(Boolean)
    : [];
  if (
    record.version !== "1" ||
    !record.name ||
    !record.homeUrl ||
    !record.ownerWallet ||
    !record.serverPublicKey
  ) {
    throw new Error("invalid_external_app_manifest");
  }
  return {
    version: "1",
    appId,
    name: String(record.name),
    homeUrl: normalizeManifestUrl(record.homeUrl),
    ownerWallet: String(record.ownerWallet),
    serverPublicKey: String(record.serverPublicKey),
    allowedOrigins,
    platforms: asRecord(record.platforms),
    capabilities,
    callbacks: asRecord(record.callbacks),
    policy: asRecord(record.policy),
  };
}

function normalizeManifestUrl(value: unknown): string {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") throw new Error("invalid protocol");
    return parsed.toString();
  } catch {
    throw new Error("invalid_external_app_manifest");
  }
}

export function computeManifestHash(manifest: ExternalAppManifest): string {
  return `sha256:${createHash("sha256").update(stableJsonStringify(manifest)).digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
