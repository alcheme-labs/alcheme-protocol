import { assertSystemCapabilityDeny } from "./riskSignals";
import type { HostedAppDataReleaseMode } from "./dataReleaseProfiles";

export function evaluateHostedAppCapability(input: {
  capabilityId: string;
  deniedCapabilities?: string[];
  platformAllowed: boolean;
  circleAllowed: boolean;
  installationAllowed: boolean;
  userConsentRequired: boolean;
  userConsented: boolean;
}): { decision: "allowed" | "denied"; reason?: string } {
  try {
    assertSystemCapabilityDeny({
      deniedCapabilities: input.deniedCapabilities,
      capabilityId: input.capabilityId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "hosted_app_capability_system_denied") {
      return { decision: "denied", reason: "system_denied" };
    }
    throw error;
  }
  if (!input.platformAllowed) return { decision: "denied", reason: "platform_denied" };
  if (!input.circleAllowed) return { decision: "denied", reason: "circle_denied" };
  if (!input.installationAllowed) return { decision: "denied", reason: "installation_denied" };
  if (input.userConsentRequired && !input.userConsented) {
    return { decision: "denied", reason: "user_consent_required" };
  }
  return { decision: "allowed" };
}

export function evaluateHostedAppDataReleaseProfile(input: {
  profileMode: HostedAppDataReleaseMode;
  warningAccepted: boolean;
}): { decision: "allowed" | "denied"; reason?: string } {
  if (input.profileMode === "third_party_server_allowed" && !input.warningAccepted) {
    return { decision: "denied", reason: "third_party_server_warning_required" };
  }
  return { decision: "allowed" };
}
