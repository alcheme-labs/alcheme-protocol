export type HostedAppRiskLevel = "none" | "info" | "warning" | "severe";

export interface HostedAppRiskSignal {
  sourceType: "circle_block" | "platform_emergency" | "appeal" | string;
  sourceRef: string;
  riskLevel: HostedAppRiskLevel;
  affectedCapabilities?: string[];
  affectedReleaseId?: string | null;
}

export function aggregateRiskSignals(signals: HostedAppRiskSignal[]): {
  riskLevel: HostedAppRiskLevel;
  independentCircleCount: number;
} {
  const independentCircleCount = new Set(
    signals
      .filter((signal) => signal.sourceType === "circle_block" && signal.riskLevel === "warning")
      .map((signal) => signal.sourceRef),
  ).size;
  if (signals.some((signal) => signal.sourceType === "platform_emergency" && signal.riskLevel === "severe")) {
    return { riskLevel: "severe", independentCircleCount };
  }
  if (independentCircleCount >= 2) {
    return { riskLevel: "severe", independentCircleCount };
  }
  if (signals.some((signal) => signal.riskLevel === "warning")) {
    return { riskLevel: "warning", independentCircleCount };
  }
  return { riskLevel: "none", independentCircleCount };
}

export function assertSystemCapabilityDeny(input: {
  deniedCapabilities?: string[];
  capabilityId: string;
}): void {
  if (input.deniedCapabilities?.includes(input.capabilityId)) {
    throw new Error("hosted_app_capability_system_denied");
  }
}
