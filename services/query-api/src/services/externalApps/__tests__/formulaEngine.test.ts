import { computeExternalAppStabilityScores } from "../formulaEngine";

describe("external app stability formula engine", () => {
  it("clamps scores to hard bounds and returns inspectable inputs and outputs", () => {
    const result = computeExternalAppStabilityScores({
      baselineRiskScore: 20,
      previousRiskScore: 20,
      previousTrustScore: 80,
      riskSignals: [{ severity: 200, weight: 4 }],
      challengePressure: 5,
      supportSignalLevel: 1000,
      supportIndependenceScore: 0.2,
      elapsedPeriods: 12,
      bounds: {
        minRiskScore: 0,
        maxRiskScore: 80,
        minTrustScore: 10,
        maxTrustScore: 95,
        maxStep: 20,
        smoothingAlpha: 1,
      },
    });

    expect(result.outputs.riskScore).toBeLessThanOrEqual(80);
    expect(result.outputs.riskScore).toBeLessThanOrEqual(40);
    expect(result.outputs.trustScore).toBeGreaterThanOrEqual(10);
    expect(result.inputs.normalizedRiskSignal).toBeGreaterThan(0);
    expect(result.outputs.appliedStepLimit).toBe(true);
  });

  it("uses hysteresis to avoid score churn for tiny changes", () => {
    const result = computeExternalAppStabilityScores({
      baselineRiskScore: 40,
      previousRiskScore: 40,
      previousTrustScore: 60,
      riskSignals: [{ severity: 41, weight: 1 }],
      challengePressure: 0,
      supportSignalLevel: 1,
      supportIndependenceScore: 0.9,
      elapsedPeriods: 1,
      bounds: { hysteresis: 3, smoothingAlpha: 0.2, maxStep: 10 },
    });

    expect(result.outputs.riskScore).toBe(40);
    expect(result.outputs.appliedHysteresis).toBe(true);
  });
});
