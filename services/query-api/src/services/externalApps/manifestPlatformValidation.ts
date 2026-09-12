import type { ExternalAppManifest } from "./manifest";

export function validateProductionManifestPlatformIdentity(
  manifest: ExternalAppManifest,
): void {
  const platforms = manifest.platforms ?? {};
  assertStringArray(platforms.nativeBundleIds, "external_app_manifest_invalid_native_bundle_ids");
  assertStringArray(platforms.desktopAppIds, "external_app_manifest_invalid_desktop_app_ids");
  validateRedirectUris(platforms.redirectUris, manifest.policy);
  validateSigningKeys(platforms.signingKeys);
  validateServerCallbacks(manifest.callbacks?.serverCallbacks);
}

function validateRedirectUris(value: unknown, policy: Record<string, unknown> | undefined) {
  if (value === undefined) return;
  const redirectUris = assertStringArray(
    value,
    "external_app_manifest_invalid_redirect_uris",
  );
  const approvedSchemes = new Set(
    Array.isArray(policy?.approvedCustomRedirectSchemes)
      ? policy.approvedCustomRedirectSchemes
          .map((scheme) => String(scheme).trim().toLowerCase())
          .filter(Boolean)
      : [],
  );
  for (const uri of redirectUris) {
    const parsed = parseUrl(uri, "external_app_manifest_invalid_redirect_uris");
    if (parsed.protocol === "https:") continue;
    const scheme = parsed.protocol.replace(":", "").toLowerCase();
    if (!approvedSchemes.has(scheme)) {
      throw new Error("external_app_manifest_redirect_uri_unapproved");
    }
  }
}

function validateServerCallbacks(value: unknown) {
  if (value === undefined) return;
  const callbacks = assertStringArray(
    value,
    "external_app_manifest_invalid_server_callbacks",
  );
  for (const callback of callbacks) {
    const parsed = parseUrl(callback, "external_app_manifest_invalid_server_callbacks");
    if (parsed.protocol !== "https:") {
      throw new Error("external_app_manifest_invalid_server_callbacks");
    }
  }
}

function validateSigningKeys(value: unknown) {
  if (value === undefined) return;
  const keys = Array.isArray(value) ? value : [value];
  for (const key of keys) {
    if (!key || typeof key !== "object" || Array.isArray(key)) {
      throw new Error("external_app_manifest_invalid_signing_keys");
    }
    const keyRecord = key as Record<string, unknown>;
    if (
      "privateKey" in keyRecord ||
      "secretKey" in keyRecord ||
      "d" in keyRecord ||
      "seed" in keyRecord
    ) {
      throw new Error("external_app_manifest_private_signing_key_rejected");
    }
  }
}

function assertStringArray(value: unknown, errorCode: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(errorCode);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function parseUrl(value: string, errorCode: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(errorCode);
  }
}
