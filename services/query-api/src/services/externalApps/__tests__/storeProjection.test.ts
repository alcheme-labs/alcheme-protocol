import {
  buildExternalAppStoreProjection,
  filterAndSortExternalAppStoreItems,
} from "../storeProjection";

describe("external app store projection", () => {
  it("builds capped ranking inputs with provenance and no external-route ranking boost", () => {
    const projection = buildExternalAppStoreProjection({
      app: {
        id: "last-ignition",
        name: "Last Ignition",
        discoveryStatus: "listed",
        managedNodePolicy: "normal",
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
      stabilityProjection: {
        policyEpochId: "epoch-1",
        challengeState: "none",
        projectionStatus: "normal",
        publicLabels: [],
        riskScore: 12,
        trustScore: 82,
        supportSignalLevel: 5000,
        supportIndependenceScore: 0.8,
        rollout: {},
        formulaInputs: {},
        formulaOutputs: {},
        statusProvenance: {},
      },
      categoryTags: ["game", "voice"],
      externalRouteDeclared: true,
    });

    expect(projection.listingState).toBe("listed_full");
    expect(projection.rankingInputs.supportSignal.cappedValue).toBeLessThanOrEqual(100);
    expect(projection.rankingInputs.externalRoute.contribution).toBe(0);
    expect(projection.continuityLabels).toContain("App-Operated Node Declared");
    expect(projection.rankingOutput.provenance).toContain("v3a_store_projection");
  });

  it("filters by search and category and uses deterministic fallback sorting", () => {
    const items = [
      buildExternalAppStoreProjection({
        app: {
          id: "old-puzzle",
          name: "Old Puzzle",
          discoveryStatus: "listed",
          managedNodePolicy: "normal",
          updatedAt: new Date("2026-05-10T00:00:00.000Z"),
        },
        categoryTags: ["puzzle"],
      }),
      buildExternalAppStoreProjection({
        app: {
          id: "last-ignition",
          name: "Last Ignition",
          discoveryStatus: "listed",
          managedNodePolicy: "normal",
          updatedAt: new Date("2026-05-14T00:00:00.000Z"),
        },
        categoryTags: ["game"],
      }),
    ];

    expect(
      filterAndSortExternalAppStoreItems(items, {
        q: "ignition",
        category: "game",
        sort: "featured",
        limit: 10,
      }).map((item) => item.externalAppId),
    ).toEqual(["last-ignition"]);
  });
});
