import {
  evaluateAuthorityDirect,
  type AuthorityDirectConfig,
} from "./authorityDirect";
import {
  evaluateConsentUnanimous,
  type ConsentUnanimousConfig,
} from "./consentUnanimous";
import type {
  GovernanceActorContext,
  GovernanceSignalInput,
  GovernanceStrategyResult,
} from "./types";

export interface PipelineAnyConfig {
  strategy: "pipeline.any";
  steps: Array<AuthorityDirectConfig | ConsentUnanimousConfig>;
}

export function evaluatePipelineAny(input: {
  config: PipelineAnyConfig;
  actor: GovernanceActorContext;
  signals: GovernanceSignalInput[];
}): GovernanceStrategyResult {
  let hasActive = false;
  const reasons: string[] = [];

  for (const step of input.config.steps) {
    const result =
      step.strategy === "authority.direct"
        ? evaluateAuthorityDirect({ config: step, actor: input.actor })
        : evaluateConsentUnanimous({ config: step, signals: input.signals });

    reasons.push(result.reason);
    if (result.state === "accepted") {
      return {
        state: "accepted",
        reason: "pipeline_any_accepted",
        tally: { acceptedBy: result.reason },
      };
    }
    if (result.state === "active") hasActive = true;
  }

  if (hasActive) {
    return {
      state: "active",
      reason: "pipeline_any_waiting",
      tally: { reasons },
    };
  }

  return {
    state: "rejected",
    reason: "pipeline_any_rejected",
    tally: { reasons },
  };
}
