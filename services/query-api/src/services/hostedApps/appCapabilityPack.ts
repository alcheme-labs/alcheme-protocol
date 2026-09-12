import { getHostedAppCapabilityDefinition } from "./capabilityCatalog";
import { digestJson } from "./digest";
import type { HostedAppCapabilityKind } from "./types";

export interface HostedAppCapabilityDeclaration {
  capabilityId: string;
  purpose: string;
  requestedAccess: HostedAppCapabilityKind;
  dataReleaseProfileId?: string;
  parameterSchemaDigest?: string;
  riskCopyRef?: string;
}

export interface HostedAppCapabilityPack {
  appId: string;
  namespace: string;
  manifestHash: string;
  declaredCapabilities: HostedAppCapabilityDeclaration[];
}

export interface HostedAppCapabilityPackValidationResult {
  ok: true;
  capabilitySetDigest: string;
  declaredCapabilityIds: string[];
}

export function buildAppCapabilityPackDigest(pack: HostedAppCapabilityPack): string {
  return digestJson({
    appId: pack.appId,
    namespace: pack.namespace,
    manifestHash: pack.manifestHash,
    declaredCapabilities: [...pack.declaredCapabilities].sort((left, right) =>
      left.capabilityId.localeCompare(right.capabilityId),
    ),
  });
}

export function validateAppCapabilityPack(
  pack: HostedAppCapabilityPack,
): HostedAppCapabilityPackValidationResult {
  const seen = new Set<string>();
  for (const declaration of pack.declaredCapabilities) {
    if (seen.has(declaration.capabilityId)) {
      throw new Error("hosted_app_capability_duplicate");
    }
    seen.add(declaration.capabilityId);

    const catalogCapability = getHostedAppCapabilityDefinition(declaration.capabilityId);
    if (!catalogCapability) {
      throw new Error("hosted_app_capability_unknown");
    }
    if (catalogCapability.kind !== declaration.requestedAccess) {
      throw new Error("hosted_app_capability_kind_mismatch");
    }
  }

  return {
    ok: true,
    capabilitySetDigest: buildAppCapabilityPackDigest(pack),
    declaredCapabilityIds: pack.declaredCapabilities.map((entry) => entry.capabilityId),
  };
}
