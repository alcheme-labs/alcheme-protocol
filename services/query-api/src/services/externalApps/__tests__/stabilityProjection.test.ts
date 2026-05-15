import { buildExternalAppStabilityProjection } from "../stabilityProjection";

describe("external app stability projection", () => {
  it("keeps V3 dispute projection separate from V2 registry status", () => {
    const projection = buildExternalAppStabilityProjection({
      app: {
        id: "last-ignition",
        name: "Last Ignition",
        status: "active",
        registryStatus: "active",
        discoveryStatus: "listed",
        riskScore: "8",
        trustScore: "80",
        communityBackingLevel: "4",
        ownerBond: null,
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
      policyEpoch: {
        id: "epoch-1",
        epochKey: "v3a-2026-05",
        rolloutSalt: "salt-1",
        exposureBasisPoints: 5000,
      },
      challenges: [{ status: "disputed", amountRaw: "10" }],
      riskSignals: [{ severity: 80, source: "user_report" }],
      backings: [{ amountRaw: "100", status: "active" }],
      viewerCohort: "public",
    });

    expect(projection.registryStatus).toBe("active");
    expect(projection.challengeState).toBe("dispute");
    expect(projection.projectionStatus).toBe("projection_disputed");
    expect(projection.publicLabels).toContain("Under Challenge");
  });

  it("uses projection status_sync_pending without mutating registry status", () => {
    const projection = buildExternalAppStabilityProjection({
      app: {
        id: "syncing-game",
        name: "Syncing Game",
        status: "active",
        registryStatus: "active",
        discoveryStatus: "listed",
        riskScore: null,
        trustScore: null,
        communityBackingLevel: null,
        ownerBond: null,
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
      registryAnchor: {
        registryStatus: "active",
        finalityStatus: "pending",
        receiptFinalityStatus: "pending",
      },
      policyEpoch: {
        id: "epoch-1",
        epochKey: "v3a-2026-05",
        rolloutSalt: "salt-1",
        exposureBasisPoints: 1000,
      },
      viewerCohort: "public",
    });

    expect(projection.registryStatus).toBe("active");
    expect(projection.projectionStatus).toBe("status_sync_pending");
  });

  it("keeps V3B bond state as projection data instead of registry status", () => {
    const projection = buildExternalAppStabilityProjection({
      app: {
        id: "bonded-game",
        status: "active",
        registryStatus: "active",
        ownerBond: "0",
      },
      ownerBondVaults: [{ status: "open", ownerBondRaw: "2500" }],
      challengeCases: [
        { status: "open", challengeBondRaw: "100" },
        { status: "settled", challengeBondRaw: "0" },
      ],
    });

    expect(projection.registryStatus).toBe("active");
    expect(projection.bondState).toMatchObject({
      ownerBondRaw: "2500",
      activeChallengeBondRaw: "100",
      activeChallengeCount: 1,
    });
  });

  it("keeps V3C bond-disposition state as projection data instead of registry status", () => {
    const projection = buildExternalAppStabilityProjection({
      app: {
        id: "bond-disposition-game",
        status: "active",
        registryStatus: "active",
        ownerBond: "1000",
      },
      bondDispositionCases: [
        { status: "locked_for_case", lockedAmountRaw: "300", routedAmountRaw: "0" },
        { status: "routed_by_policy", lockedAmountRaw: "0", routedAmountRaw: "50" },
      ],
      riskDisclaimerAccepted: true,
    });

    expect(projection.registryStatus).toBe("active");
    expect(projection.projectionStatus).toBe("normal");
    expect(projection.bondDispositionState).toEqual({
      state: "locked_for_case",
      activeLockedAmountRaw: "300",
      totalRoutedAmountRaw: "50",
      activeCaseCount: 1,
      riskDisclaimerAccepted: true,
      riskDisclaimerRequired: true,
    });
    expect(projection.statusProvenance.bondDispositionState).toMatchObject({
      source: "external_app_v3c_projection",
    });
  });

  it("keeps V3D governance state as projection data instead of registry status", () => {
    const projection = buildExternalAppStabilityProjection({
      app: {
        id: "governance-watch-game",
        status: "active",
        registryStatus: "active",
        ownerBond: "1000",
      },
      captureReviews: [{ status: "open" }],
      projectionDisputes: [{ status: "open" }],
      emergencyHolds: [
        {
          status: "active",
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });

    expect(projection.registryStatus).toBe("active");
    expect(projection.projectionStatus).toBe("normal");
    expect(projection.governanceState).toMatchObject({
      captureReviewStatus: "open",
      projectionDisputeStatus: "open",
      emergencyHoldStatus: "active",
      highImpactActionsPaused: true,
    });
    expect(projection.publicLabels).toEqual(
      expect.arrayContaining([
        "Capture Review",
        "Projection Disputed",
        "Scoped Emergency Hold",
      ]),
    );
    expect(projection.statusProvenance.governanceState).toMatchObject({
      source: "external_app_v3d_projection",
    });
  });
});
