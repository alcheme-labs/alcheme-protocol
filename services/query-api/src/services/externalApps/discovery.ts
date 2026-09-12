import {
  isExternalAppChainTrusted,
  type ExternalAppRegistryAnchorProjection,
} from "./chainRegistryProjection";
import type { ExternalAppRegistryMode } from "./chainRegistryAdapter";

export function shouldIncludeInDiscovery(input: {
  status?: string;
  environment?: string | null;
  discoveryStatus: string;
  registryStatus: string;
  registryAnchor?: ExternalAppRegistryAnchorProjection | null;
  registryMode?: ExternalAppRegistryMode;
}): boolean {
  if (input.status && input.status !== "active") return false;
  if (
    !isExternalAppChainTrusted({
      app: {
        environment: input.environment,
        registryStatus: input.registryStatus,
      },
      anchor: input.registryAnchor,
      mode: input.registryMode,
    })
  ) {
    return false;
  }
  return input.discoveryStatus === "listed" || input.discoveryStatus === "limited";
}
