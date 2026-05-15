export interface ExternalAppRiskSignalInput {
  severity: number;
  weight?: number;
}

export interface ExternalAppFormulaBounds {
  minRiskScore?: number;
  maxRiskScore?: number;
  minTrustScore?: number;
  maxTrustScore?: number;
  maxStep?: number;
  hysteresis?: number;
  smoothingAlpha?: number;
}

export interface ExternalAppFormulaInput {
  baselineRiskScore?: number | null;
  previousRiskScore?: number | null;
  previousTrustScore?: number | null;
  riskSignals?: ExternalAppRiskSignalInput[];
  challengePressure?: number | null;
  supportSignalLevel?: number | null;
  supportIndependenceScore?: number | null;
  elapsedPeriods?: number | null;
  bounds?: ExternalAppFormulaBounds;
}

export function computeExternalAppStabilityScores(input: ExternalAppFormulaInput) {
  const bounds = normalizeBounds(input.bounds);
  const baselineRiskScore = clamp(
    finiteNumber(input.baselineRiskScore, 20),
    bounds.minRiskScore,
    bounds.maxRiskScore,
  );
  const previousRiskScore = clamp(
    finiteNumber(input.previousRiskScore, baselineRiskScore),
    bounds.minRiskScore,
    bounds.maxRiskScore,
  );
  const previousTrustScore = clamp(
    finiteNumber(input.previousTrustScore, 100 - previousRiskScore),
    bounds.minTrustScore,
    bounds.maxTrustScore,
  );
  const normalizedRiskSignal = normalizeRiskSignals(input.riskSignals ?? []);
  const pressureScore = clamp(finiteNumber(input.challengePressure, 0) * 100, 0, 100);
  const supportSignalLevel = clamp(finiteNumber(input.supportSignalLevel, 0), 0, 100);
  const supportIndependenceScore = clamp(
    finiteNumber(input.supportIndependenceScore, 0),
    0,
    1,
  );
  const independentSupport = supportSignalLevel * supportIndependenceScore;
  const rawRiskScore = clamp(
    baselineRiskScore * 0.4 +
      normalizedRiskSignal * 0.35 +
      pressureScore * 0.25 -
      independentSupport * 0.1,
    bounds.minRiskScore,
    bounds.maxRiskScore,
  );
  const elapsedPeriods = Math.max(0, finiteNumber(input.elapsedPeriods, 1));
  const growthFactor = 1 - Math.exp(-elapsedPeriods / 6);
  const grownRiskScore =
    baselineRiskScore + (rawRiskScore - baselineRiskScore) * growthFactor;
  const smoothedRiskScore =
    previousRiskScore + (grownRiskScore - previousRiskScore) * bounds.smoothingAlpha;
  const steppedRisk = applyHysteresisAndStep({
    previous: previousRiskScore,
    next: smoothedRiskScore,
    hysteresis: bounds.hysteresis,
    maxStep: bounds.maxStep,
  });
  const riskScore = clamp(roundScore(steppedRisk.value), bounds.minRiskScore, bounds.maxRiskScore);

  const rawTrustScore = clamp(
    100 - riskScore + independentSupport * 0.1,
    bounds.minTrustScore,
    bounds.maxTrustScore,
  );
  const smoothedTrustScore =
    previousTrustScore + (rawTrustScore - previousTrustScore) * bounds.smoothingAlpha;
  const steppedTrust = applyHysteresisAndStep({
    previous: previousTrustScore,
    next: smoothedTrustScore,
    hysteresis: bounds.hysteresis,
    maxStep: bounds.maxStep,
  });
  const trustScore = clamp(
    roundScore(steppedTrust.value),
    bounds.minTrustScore,
    bounds.maxTrustScore,
  );

  return {
    inputs: {
      baselineRiskScore,
      previousRiskScore,
      previousTrustScore,
      normalizedRiskSignal,
      pressureScore,
      supportSignalLevel,
      supportIndependenceScore,
      independentSupport,
      elapsedPeriods,
      bounds,
    },
    outputs: {
      rawRiskScore: roundScore(rawRiskScore),
      growthFactor: roundScore(growthFactor),
      smoothedRiskScore: roundScore(smoothedRiskScore),
      riskScore,
      trustScore,
      appliedHysteresis: steppedRisk.appliedHysteresis || steppedTrust.appliedHysteresis,
      appliedStepLimit: steppedRisk.appliedStepLimit || steppedTrust.appliedStepLimit,
    },
  };
}

function normalizeRiskSignals(signals: ExternalAppRiskSignalInput[]): number {
  if (signals.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    const weight = Math.max(0, finiteNumber(signal.weight, 1));
    weighted += clamp(finiteNumber(signal.severity, 0), 0, 100) * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return clamp(weighted / totalWeight, 0, 100);
}

function applyHysteresisAndStep(input: {
  previous: number;
  next: number;
  hysteresis: number;
  maxStep: number;
}) {
  const delta = input.next - input.previous;
  if (Math.abs(delta) < input.hysteresis) {
    return {
      value: input.previous,
      appliedHysteresis: true,
      appliedStepLimit: false,
    };
  }
  if (Math.abs(delta) > input.maxStep) {
    return {
      value: input.previous + Math.sign(delta) * input.maxStep,
      appliedHysteresis: false,
      appliedStepLimit: true,
    };
  }
  return { value: input.next, appliedHysteresis: false, appliedStepLimit: false };
}

function normalizeBounds(bounds: ExternalAppFormulaBounds = {}) {
  return {
    minRiskScore: finiteNumber(bounds.minRiskScore, 0),
    maxRiskScore: finiteNumber(bounds.maxRiskScore, 100),
    minTrustScore: finiteNumber(bounds.minTrustScore, 0),
    maxTrustScore: finiteNumber(bounds.maxTrustScore, 100),
    maxStep: Math.max(1, finiteNumber(bounds.maxStep, 15)),
    hysteresis: Math.max(0, finiteNumber(bounds.hysteresis, 1)),
    smoothingAlpha: clamp(finiteNumber(bounds.smoothingAlpha, 0.35), 0.01, 1),
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
