import {
  validateAppCapabilityPack,
  type HostedAppCapabilityPack,
} from "./appCapabilityPack";
import type { HostedAppTrustState } from "./types";

export interface HostedAppReleaseCapabilityReview {
  capabilitySetDigest: string;
  declaredCapabilityIds: string[];
  authorizedCapabilityIds: string[];
}

export function reviewHostedAppReleaseCapabilityPack(
  pack: HostedAppCapabilityPack,
): HostedAppReleaseCapabilityReview {
  const validated = validateAppCapabilityPack(pack);
  return {
    capabilitySetDigest: validated.capabilitySetDigest,
    declaredCapabilityIds: validated.declaredCapabilityIds,
    authorizedCapabilityIds: [],
  };
}

export interface HostedAppRunTrust {
  appId: string;
  allowedManifestHash: string;
  trustState: HostedAppTrustState;
  allowedCapabilities: string[];
}

export interface HostedAppRunInstallation {
  appId: string;
  currentReleaseId: string;
  manifestHash: string;
  status: "active" | "suspended" | "revoked" | string;
  allowedCapabilities: string[];
}

export function assertReleaseCanRun(input: {
  appId: string;
  manifestHash: string;
  releaseId: string;
  trust: HostedAppRunTrust | null;
  installation: HostedAppRunInstallation | null;
}): void {
  if (!input.trust || input.trust.appId !== input.appId) {
    throw new Error("hosted_app_trust_missing");
  }
  if (!input.installation || input.installation.appId !== input.appId) {
    throw new Error("hosted_app_installation_missing");
  }
  if (input.trust.trustState !== "active") {
    throw new Error(`hosted_app_trust_${input.trust.trustState}`);
  }
  if (input.installation.status !== "active") {
    throw new Error(`hosted_app_installation_${input.installation.status}`);
  }
  if (input.trust.allowedManifestHash !== input.manifestHash) {
    throw new Error("hosted_app_manifest_not_trusted");
  }
  if (input.installation.manifestHash !== input.manifestHash) {
    throw new Error("hosted_app_installation_manifest_mismatch");
  }
  if (input.installation.currentReleaseId !== input.releaseId) {
    throw new Error("hosted_app_release_not_installed");
  }
}
