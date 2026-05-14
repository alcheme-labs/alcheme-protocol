import { computeBackingLevel, computeChallengePressure } from "../backing";

describe("external app backing scores", () => {
  it("uses diminishing backing returns", () => {
    expect(computeBackingLevel(["400"])).toBeLessThan(400);
    expect(computeBackingLevel(["1000000"])).toBeLessThan(1000000);
  });

  it("computes challenge pressure against backing", () => {
    expect(computeChallengePressure({ backingRaw: "1000", challengeRaw: "100" })).toBeCloseTo(0.1);
  });
});
