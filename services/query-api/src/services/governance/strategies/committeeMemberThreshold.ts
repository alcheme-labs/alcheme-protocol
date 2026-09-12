import type { GovernanceEligibleActor } from "../policyEngine";
import { canonicalSolanaPublicKeyString } from "../../identity/solanaPublicKey";
import type { GovernanceSignalInput, GovernanceStrategyResult } from "./types";

export interface CommitteeMemberThresholdConfig {
  strategy: "committee.member_threshold";
  threshold?: {
    mode?: "default_majority" | "fixed_count" | "unanimity";
    value?: number;
  };
  voteReplacement?: {
    mode: "not_allowed";
    deadline: "request_expires_at";
  };
  ballotDisclosure?: {
    mode: "public" | "member" | "eligible_only" | "aggregate_until_close" | "provider_defined";
  };
  quadraticVoiceCredits?: {
    budgetPerActor: number;
  };
}

export const DEFAULT_COMMITTEE_VOTE_REPLACEMENT = {
  mode: "not_allowed",
  deadline: "request_expires_at",
} as const;

export function resolveCommitteeMemberThresholdConfig(
  rules: unknown,
  ruleId: string,
): CommitteeMemberThresholdConfig {
  const record = asRecord(rules);
  const list = Array.isArray(record.rules) ? record.rules : [];
  const rule = list.find((item) => asRecord(item).id === ruleId);
  const ruleRecord = asRecord(rule);
  if (ruleRecord.strategy !== "committee.member_threshold") {
    throw new Error("governance_rule_not_committee_member_threshold");
  }
  const threshold = asRecord(ruleRecord.threshold);
  const thresholdMode = threshold.mode === "fixed_count"
    || threshold.mode === "unanimity"
    || threshold.mode === "default_majority"
    ? threshold.mode
    : null;
  const replacement = asRecord(ruleRecord.voteReplacement);
  const ballotDisclosure = asRecord(ruleRecord.ballotDisclosure);
  const quadraticVoiceCredits = asRecord(ruleRecord.quadraticVoiceCredits);
  if (
    Object.keys(replacement).length > 0
    && (
      replacement.mode !== DEFAULT_COMMITTEE_VOTE_REPLACEMENT.mode
      || replacement.deadline !== DEFAULT_COMMITTEE_VOTE_REPLACEMENT.deadline
    )
  ) {
    throw new Error("governance_vote_replacement_policy_unsupported");
  }
  if (
    Object.keys(ballotDisclosure).length > 0
    && !isBallotDisclosureMode(ballotDisclosure.mode)
  ) {
    throw new Error("governance_ballot_disclosure_policy_unsupported");
  }
  const budgetConfigured = quadraticVoiceCredits.budgetPerActor !== null
    && quadraticVoiceCredits.budgetPerActor !== undefined;
  const budgetPerActor = Number(quadraticVoiceCredits.budgetPerActor);
  if (
    budgetConfigured
    && (!Number.isSafeInteger(budgetPerActor) || budgetPerActor < 1 || budgetPerActor > 1_000_000)
  ) {
    throw new Error('governance_qv_credit_budget_invalid');
  }
  return {
    strategy: "committee.member_threshold",
    threshold: thresholdMode
      ? {
          mode: thresholdMode,
          value: typeof threshold.value === "number" ? threshold.value : undefined,
        }
      : undefined,
    voteReplacement: DEFAULT_COMMITTEE_VOTE_REPLACEMENT,
    ballotDisclosure: isBallotDisclosureMode(ballotDisclosure.mode)
      ? { mode: ballotDisclosure.mode }
      : undefined,
    quadraticVoiceCredits: budgetConfigured
      ? { budgetPerActor }
      : undefined,
  };
}

export function evaluateCommitteeMemberThreshold(input: {
  config: CommitteeMemberThresholdConfig;
  eligibleActors: GovernanceEligibleActor[];
  signals: GovernanceSignalInput[];
}): GovernanceStrategyResult {
  const eligibleByPubkey = new Map<string, GovernanceEligibleActor>();
  for (const actor of input.eligibleActors) {
    const pubkey = canonicalSolanaPublicKeyString(actor.pubkey);
    if (!pubkey) {
      throw new Error("invalid_governance_snapshot_actor_pubkey");
    }
    if (!eligibleByPubkey.has(pubkey)) {
      eligibleByPubkey.set(pubkey, actor);
    }
  }

  const latestByActor = new Map<string, {
    actorPubkey: string;
    choice: "approve" | "reject" | "abstain";
    configuredWeight: string;
    countedWeight: "1";
    signalId: string | null;
  }>();
  const ignoredSignalDetails: Array<{
    signalId: string | null;
    actorPubkey: string | null;
    reason: "actor_not_eligible" | "choice_invalid" | "duplicate_actor_signal";
  }> = [];
  for (const signal of input.signals) {
    const actor = canonicalSolanaPublicKeyString(signal.actorPubkey);
    const value = normalizeChoice(signal.value);
    if (!actor || !eligibleByPubkey.has(actor)) {
      ignoredSignalDetails.push({
        signalId: signal.id ?? null,
        actorPubkey: actor ?? null,
        reason: "actor_not_eligible",
      });
      continue;
    }
    if (
      value === "approve"
      || value === "reject"
      || value === "abstain"
    ) {
      const eligibleActor = eligibleByPubkey.get(actor)!;
      if (latestByActor.has(actor)) {
        ignoredSignalDetails.push({
          signalId: signal.id ?? null,
          actorPubkey: actor,
          reason: "duplicate_actor_signal",
        });
        continue;
      }
      latestByActor.set(actor, {
        actorPubkey: actor,
        choice: value,
        configuredWeight: eligibleActor.weight,
        countedWeight: "1",
        signalId: signal.id ?? null,
      });
    } else {
      ignoredSignalDetails.push({
        signalId: signal.id ?? null,
        actorPubkey: actor,
        reason: "choice_invalid",
      });
    }
  }

  const eligibleActors = Array.from(eligibleByPubkey.values())
    .map((actor) => ({
      pubkey: canonicalSolanaPublicKeyString(actor.pubkey)!,
      role: actor.role ?? null,
      weight: actor.weight,
      source: actor.source,
    }))
    .sort((left, right) => left.pubkey.localeCompare(right.pubkey));
  const choices = Array.from(latestByActor.values())
    .sort((left, right) => left.actorPubkey.localeCompare(right.actorPubkey));
  const ignoredSignals = ignoredSignalDetails
    .sort((left, right) => (
      String(left.actorPubkey ?? "").localeCompare(String(right.actorPubkey ?? ""))
      || String(left.signalId ?? "").localeCompare(String(right.signalId ?? ""))
      || left.reason.localeCompare(right.reason)
    ));
  const eligible = eligibleActors.length;
  const approvalThreshold = resolveCommitteeMemberApprovalThreshold(input.config, eligible);
  const rejectionThreshold = approvalThreshold;
  const approved = choices.filter(
    (value) => value.choice === "approve",
  ).length;
  const rejected = choices.filter(
    (value) => value.choice === "reject",
  ).length;
  const abstained = choices.filter(
    (value) => value.choice === "abstain",
  ).length;
  const participation = choices.length;
  const tied = approved === rejected && participation > 0;
  const acceptedEarly = approved >= approvalThreshold;
  const rejectedEarly = rejected >= rejectionThreshold;
  const tally = {
    schemaVersion: 1,
    strategy: "committee.member_threshold",
    eligible,
    eligibleActors,
    approvalThreshold,
    rejectionThreshold,
    approved,
    rejected,
    abstained,
    choices,
    quorum: {
      mode: "threshold_participation",
      required: approvalThreshold,
      participation,
      numerator: participation,
      denominator: eligible,
      met: participation >= approvalThreshold,
    },
    ignoredSignalCount: ignoredSignals.length,
    ignoredSignals,
    voteReplacement: input.config.voteReplacement ?? DEFAULT_COMMITTEE_VOTE_REPLACEMENT,
    abstention: {
      participation: "counts",
      decisionThreshold: "does_not_count",
    },
    tie: {
      status: tied ? "tied" : "not_tied",
      resolution: "pending_until_request_expires",
      terminalAtDeadline: "expired",
    },
    earlyFinalization: {
      mode: "threshold_reached",
      reached: acceptedEarly || rejectedEarly,
    },
    voteHistory: {
      mode: "append_only_first_accepted_signal",
      acceptedSignalCount: participation,
      replacement: "not_allowed",
    },
    deadline: { source: "request_expires_at" },
  };

  if (eligible <= 0) {
    return {
      state: "rejected",
      reason: "committee_no_eligible_members",
      tally,
    };
  }
  if (approved >= approvalThreshold) {
    return {
      state: "accepted",
      reason: "committee_threshold_accepted",
      tally,
    };
  }
  if (rejected >= rejectionThreshold) {
    return {
      state: "rejected",
      reason: "committee_threshold_rejected",
      tally,
    };
  }

  return {
    state: "active",
    reason: "committee_threshold_pending",
    tally,
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function resolveCommitteeMemberApprovalThreshold(
  config: CommitteeMemberThresholdConfig,
  eligible: number,
): number {
  if (eligible <= 0) return 1;
  if (config.threshold?.mode === "fixed_count") {
    const value = Number(config.threshold.value);
    return Number.isInteger(value) && value > 0 ? value : 1;
  }
  if (config.threshold?.mode === "unanimity") {
    return eligible;
  }
  if (eligible === 1) return 1;
  if (eligible === 2) return 2;
  return Math.floor(eligible / 2) + 1;
}

function normalizeChoice(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isBallotDisclosureMode(
  value: unknown,
): value is NonNullable<CommitteeMemberThresholdConfig["ballotDisclosure"]>["mode"] {
  return value === "public"
    || value === "member"
    || value === "eligible_only"
    || value === "aggregate_until_close"
    || value === "provider_defined";
}
