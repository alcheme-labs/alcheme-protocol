import {
  parseExternalAppRegistryMode,
  type ExternalAppRegistryMode,
} from "./chainRegistryAdapter";

export interface ExternalAppRegistryAnchorProjection {
  registryStatus?: string | null;
  finalityStatus?: string | null;
  receiptFinalityStatus?: string | null;
}

export interface ExternalAppTrustProjection {
  environment?: string | null;
  registryStatus?: string | null;
}

const TRUSTED_FINALITY = new Set(["confirmed", "finalized"]);

export function externalAppRegistryModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExternalAppRegistryMode {
  return parseExternalAppRegistryMode(env.EXTERNAL_APP_REGISTRY_MODE);
}

export function isExternalAppChainTrusted(input: {
  app: ExternalAppTrustProjection;
  anchor?: ExternalAppRegistryAnchorProjection | null;
  mode?: ExternalAppRegistryMode;
}): boolean {
  if (input.app.registryStatus && input.app.registryStatus !== "active") {
    return false;
  }

  if (input.mode !== "required" || input.app.environment !== "mainnet_production") {
    return true;
  }

  return Boolean(
    input.anchor &&
      input.anchor.registryStatus === "active" &&
      TRUSTED_FINALITY.has(String(input.anchor.finalityStatus || "")) &&
      TRUSTED_FINALITY.has(String(input.anchor.receiptFinalityStatus || "")),
  );
}
