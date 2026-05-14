export function shouldIncludeInDiscovery(input: {
  status?: string;
  discoveryStatus: string;
  registryStatus: string;
}): boolean {
  if (input.status && input.status !== "active") return false;
  if (input.registryStatus === "revoked") return false;
  return input.discoveryStatus === "listed" || input.discoveryStatus === "limited";
}
