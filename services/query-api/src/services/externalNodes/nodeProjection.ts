export interface ExternalNodeProjectionInput {
  id: string;
  operatorPubkey: string;
  nodeType: string;
  serviceUrl: string;
  capabilitiesDigest?: string | null;
  protocolVersion?: string | null;
  syncStatus: string;
  nodePolicyStatus: string;
  conformanceStatus?: string | null;
  nodeTrustScore?: string | null;
}

export function buildExternalNodeProjection(input: ExternalNodeProjectionInput) {
  if (
    !input.operatorPubkey ||
    !input.serviceUrl ||
    !input.capabilitiesDigest ||
    !input.protocolVersion
  ) {
    return null;
  }
  return {
    id: input.id,
    label:
      input.nodeType === "app_owned"
        ? "App-Operated Node Declared"
        : "External Route Declared",
    operatorPubkey: input.operatorPubkey,
    nodeType: input.nodeType,
    serviceUrl: input.serviceUrl,
    capabilitiesDigest: input.capabilitiesDigest,
    protocolVersion: input.protocolVersion,
    syncStatus: input.syncStatus,
    nodePolicyStatus: input.nodePolicyStatus,
    provenance: {
      source: "external_nodes",
      routeOperator: input.operatorPubkey,
    },
    endorsement: "not_alcheme_endorsed",
    noEndorsementText:
      "This route is operated by the external app or a third party, not by Alcheme.",
    rankingContribution: 0,
  };
}
