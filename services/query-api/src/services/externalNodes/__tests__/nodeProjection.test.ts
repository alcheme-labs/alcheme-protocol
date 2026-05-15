import { buildExternalNodeProjection } from "../nodeProjection";

describe("external node projection", () => {
  it("shows app-operated route provenance without certification or ranking semantics", () => {
    const projection = buildExternalNodeProjection({
      id: "node-1",
      operatorPubkey: "operator-wallet",
      nodeType: "app_owned",
      serviceUrl: "https://node.game.example",
      capabilitiesDigest: "sha256:abc",
      protocolVersion: "v1",
      syncStatus: "healthy",
      nodePolicyStatus: "normal",
      conformanceStatus: "certified",
      nodeTrustScore: "100",
    });

    expect(projection).toMatchObject({
      label: "App-Operated Node Declared",
      rankingContribution: 0,
      endorsement: "not_alcheme_endorsed",
    });
    expect(JSON.stringify(projection)).not.toMatch(/Certified|Recommended|Trusted|Alcheme Compatible/);
    expect(projection).not.toHaveProperty("nodeTrustScore");
    expect(projection).not.toHaveProperty("conformanceStatus");
  });

  it("requires route provenance fields before displaying a route label", () => {
    expect(
      buildExternalNodeProjection({
        id: "node-1",
        operatorPubkey: "operator-wallet",
        nodeType: "app_owned",
        serviceUrl: "https://node.game.example",
        capabilitiesDigest: null,
        protocolVersion: "v1",
        syncStatus: "healthy",
        nodePolicyStatus: "normal",
      }),
    ).toBeNull();
  });
});
