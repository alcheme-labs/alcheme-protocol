import { computeGreyRolloutExposure } from "../greyRollout";

describe("external app grey rollout", () => {
  it("returns deterministic exposure for the same app, cohort, epoch, and salt", () => {
    const first = computeGreyRolloutExposure({
      appId: "last-ignition",
      viewerCohort: "public",
      policyEpoch: "epoch-1",
      rolloutSalt: "salt-1",
      exposureBasisPoints: 2500,
    });
    const second = computeGreyRolloutExposure({
      appId: "last-ignition",
      viewerCohort: "public",
      policyEpoch: "epoch-1",
      rolloutSalt: "salt-1",
      exposureBasisPoints: 2500,
    });

    expect(second).toEqual(first);
    expect(first.bucket).toBeGreaterThanOrEqual(0);
    expect(first.bucket).toBeLessThan(10_000);
  });

  it("is monotonic when exposure basis points increase", () => {
    const base = {
      appId: "last-ignition",
      viewerCohort: "public",
      policyEpoch: "epoch-1",
      rolloutSalt: "salt-1",
    };
    const low = computeGreyRolloutExposure({ ...base, exposureBasisPoints: 1000 });
    const high = computeGreyRolloutExposure({ ...base, exposureBasisPoints: 8000 });

    if (low.exposed) {
      expect(high.exposed).toBe(true);
    }
    expect(high.exposureBasisPoints).toBeGreaterThan(low.exposureBasisPoints);
  });
});
