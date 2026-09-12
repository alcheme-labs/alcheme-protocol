import { digestJson } from "./digest";

export type HostedAppNetworkPolicy =
  | "no_external_network"
  | "declared_endpoints_only"
  | "open_web_with_warning";

export function assertHostedAppOriginAllowed(input: {
  eventOrigin: string;
  allowedOrigins: string[];
}): void {
  if (!input.allowedOrigins.includes(input.eventOrigin)) {
    throw new Error("hosted_app_origin_denied");
  }
}

export function assertHostedAppBridgeMessageAllowed(input: {
  eventOrigin: string;
  eventSourceMatchesFrame: boolean;
  receivedBridgeSessionToken?: string | null;
  expectedBridgeSessionToken: string;
  allowedOrigins: string[];
}): void {
  if (!input.eventSourceMatchesFrame) {
    throw new Error("hosted_app_bridge_source_denied");
  }
  if (input.receivedBridgeSessionToken !== input.expectedBridgeSessionToken) {
    throw new Error("hosted_app_bridge_token_invalid");
  }
  assertHostedAppOriginAllowed({
    eventOrigin: input.eventOrigin,
    allowedOrigins: input.allowedOrigins,
  });
}

export function assertManagedAppOriginIsIsolated(input: {
  appOrigin: string;
  forbiddenOrigins: string[];
  requiredSuffix: string;
}): void {
  const origin = new URL(input.appOrigin).origin;
  const forbiddenOrigins = input.forbiddenOrigins.map((value) => new URL(value).origin);
  if (forbiddenOrigins.includes(origin)) {
    throw new Error("hosted_app_origin_not_isolated");
  }
  if (!new URL(origin).hostname.endsWith(input.requiredSuffix)) {
    throw new Error("hosted_app_origin_not_managed");
  }
}

export function assertHostedAppEndpointAllowed(input: {
  endpoint: string;
  networkPolicy: HostedAppNetworkPolicy;
  declaredEndpoints: string[];
}): void {
  if (input.networkPolicy === "no_external_network") {
    throw new Error("hosted_app_external_network_denied");
  }
  if (
    input.networkPolicy === "declared_endpoints_only" &&
    !input.declaredEndpoints.some((endpoint) => input.endpoint.startsWith(endpoint))
  ) {
    throw new Error("hosted_app_endpoint_denied");
  }
}

export function buildRuntimeSessionDigest(input: {
  appId: string;
  releaseId: string;
  circleId: number;
  userPubkey: string;
  manifestHash: string;
  capabilitySetDigest: string;
  nonce: string;
}): string {
  return digestJson(input);
}

export function deriveHostedAppActor(input: {
  authenticatedPubkey?: string | null;
}): string {
  const actor = input.authenticatedPubkey;
  if (!actor) throw new Error("hosted_app_actor_required");
  return actor;
}
