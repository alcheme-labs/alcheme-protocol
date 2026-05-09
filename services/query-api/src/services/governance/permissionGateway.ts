import type { GovernanceStrategyResult } from "./strategies/types";
import {
  evaluateConsentUnanimous,
  type ConsentUnanimousConfig,
} from "./strategies/consentUnanimous";
import type { GovernanceSignalInput } from "./strategies/types";

export type GovernancePermissionDecision =
  | { status: "allow"; reason: string; requestId?: string }
  | { status: "deny"; reason: string; requestId?: string }
  | { status: "requires_governance"; reason: string; requestId?: string };

export function toPermissionGatewayDecision(
  result: GovernanceStrategyResult,
): GovernancePermissionDecision {
  if (result.state === "accepted") {
    return {
      status: "allow",
      reason: result.reason,
      requestId: result.requestId,
    };
  }
  if (result.state === "rejected") {
    return {
      status: "deny",
      reason: result.reason,
      requestId: result.requestId,
    };
  }
  return {
    status: "requires_governance",
    reason: result.reason,
    requestId: result.requestId,
  };
}

export function evaluateVoiceTranscriptionEnablePermission(input: {
  requestId: string;
  participantPubkeys: string[];
  signals: GovernanceSignalInput[];
}): GovernancePermissionDecision {
  const config: ConsentUnanimousConfig = {
    strategy: "consent.unanimous",
    requiredParties: input.participantPubkeys,
  };
  return toPermissionGatewayDecision({
    ...evaluateConsentUnanimous({ config, signals: input.signals }),
    requestId: input.requestId,
  });
}
