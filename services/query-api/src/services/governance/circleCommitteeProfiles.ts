import { listCommitteeEligibleActors } from "./circleCommitteeActors";

export type CircleGovernanceCommitteeAvailabilityStatus = "disabled" | "enabled";

export interface CircleGovernanceCommitteeElectorateTemplate {
  source: "active_committee_members";
  weight: { mode: "equal_one" };
  threshold: {
    mode: "default_majority" | "fixed_count" | "unanimity";
    value: number | null;
  };
  ballotDisclosure: {
    mode: "public" | "member" | "eligible_only" | "aggregate_until_close" | "provider_defined";
  };
  quadraticVoiceCredits: {
    budgetPerActor: number | null;
  };
}

export const DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE: CircleGovernanceCommitteeElectorateTemplate = {
  source: "active_committee_members",
  weight: { mode: "equal_one" },
  threshold: { mode: "default_majority", value: null },
  ballotDisclosure: { mode: "member" },
  quadraticVoiceCredits: { budgetPerActor: null },
};

export interface CircleGovernanceCommitteeProfileRecord {
  circleId: number;
  availabilityStatus: CircleGovernanceCommitteeAvailabilityStatus;
  allowedActionPrefixes: string[] | null;
  defaultStrategy: string;
  electorateTemplate: CircleGovernanceCommitteeElectorateTemplate;
  windowMinutes: number | null;
  updatedByPubkey: string | null;
  availabilityOpenedAt: Date | null;
  availabilityExpiresAt: Date | null;
  lastMandateRequestId: string | null;
  lastMandateRequestAt: Date | null;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export const DEFAULT_COMMITTEE_RECEIVE_WINDOW_MINUTES = 10;
export const MIN_COMMITTEE_RECEIVE_WINDOW_MINUTES = 1;
export const MAX_COMMITTEE_RECEIVE_WINDOW_MINUTES = 30;
export const DEFAULT_COMMITTEE_RECEIVE_WINDOW_PREFIXES = ["circle.lifecycle"];
export const COMMITTEE_RECEIVE_WINDOW_PREFIXES = [
  "circle.lifecycle",
  "circle.governance_binding",
  "circle.membership",
  "circle.owner",
  "circle.policy",
  "grant",
  "communication.member.mute",
  "communication.message.hide",
  "operator.capability.suspend",
  "content.visibility.downrank",
  "feed.ranking.policy.update",
  "feed.recommendation.experiment.start",
  "feed.recommendation.experiment.stop",
] as const;

type CircleCommitteeProfilePrisma = {
  circleGovernanceCommitteeProfile: {
    findUnique(input: unknown): Promise<unknown | null>;
    upsert(input: unknown): Promise<unknown>;
    update(input: unknown): Promise<unknown>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  circle: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  circleMember: {
    findMany(input: unknown): Promise<unknown[]>;
  };
};

export async function resolveCircleGovernanceCommitteeProfile(
  prisma: Pick<CircleCommitteeProfilePrisma, "circleGovernanceCommitteeProfile">,
  input: {
    circleId: number;
    now?: Date;
  },
): Promise<CircleGovernanceCommitteeProfileRecord> {
  const now = input.now ?? new Date();
  const profile = normalizeProfile(input.circleId, await prisma.circleGovernanceCommitteeProfile.findUnique({
    where: { circleId: input.circleId },
  }));
  if (isProfileExpired(profile, now)) {
    const closed = await prisma.circleGovernanceCommitteeProfile.update({
      where: { circleId: input.circleId },
      data: {
        availabilityStatus: "disabled",
        availabilityExpiresAt: null,
        deactivatedAt: now,
      },
    });
    return normalizeProfile(input.circleId, closed);
  }
  return profile;
}

export async function setCircleGovernanceCommitteeAvailability(
  prisma: CircleCommitteeProfilePrisma,
  input: {
    circleId: number;
    availabilityStatus: CircleGovernanceCommitteeAvailabilityStatus;
    actorPubkey?: string | null;
    windowMinutes?: number | null;
    allowedActionPrefixes?: string[] | null;
    electorateTemplate?: unknown;
    now?: Date;
  },
): Promise<CircleGovernanceCommitteeProfileRecord> {
  const now = input.now ?? new Date();
  if (input.availabilityStatus === "enabled") {
    const eligibleActorCount = await assertCircleCanReceiveGovernanceMandates(prisma, input.circleId);
    const windowMinutes = normalizeWindowMinutes(input.windowMinutes);
    const allowedActionPrefixes = normalizeAllowedActionPrefixes(input.allowedActionPrefixes);
    const electorateTemplate = normalizeCircleGovernanceCommitteeElectorateTemplate(
      input.electorateTemplate,
      eligibleActorCount,
    );
    const availabilityExpiresAt = new Date(now.getTime() + windowMinutes * 60_000);
    return normalizeProfile(input.circleId, await prisma.circleGovernanceCommitteeProfile.upsert({
      where: { circleId: input.circleId },
      create: {
        circleId: input.circleId,
        availabilityStatus: "enabled",
        allowedActionPrefixes,
        defaultStrategy: "committee.member_threshold",
        electorateTemplate,
        windowMinutes,
        updatedByPubkey: input.actorPubkey ?? null,
        availabilityOpenedAt: now,
        availabilityExpiresAt,
        lastMandateRequestId: null,
        lastMandateRequestAt: null,
        activatedAt: now,
        deactivatedAt: null,
      },
      update: {
        availabilityStatus: "enabled",
        allowedActionPrefixes,
        electorateTemplate,
        windowMinutes,
        updatedByPubkey: input.actorPubkey ?? null,
        availabilityOpenedAt: now,
        availabilityExpiresAt,
        lastMandateRequestId: null,
        lastMandateRequestAt: null,
        activatedAt: now,
        deactivatedAt: null,
      },
    }));
  }

  return normalizeProfile(input.circleId, await prisma.circleGovernanceCommitteeProfile.upsert({
    where: { circleId: input.circleId },
    create: {
      circleId: input.circleId,
      availabilityStatus: "disabled",
      allowedActionPrefixes: null,
      defaultStrategy: "committee.member_threshold",
      electorateTemplate: DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE,
      windowMinutes: null,
      updatedByPubkey: input.actorPubkey ?? null,
      availabilityOpenedAt: null,
      availabilityExpiresAt: null,
      lastMandateRequestId: null,
      lastMandateRequestAt: null,
      activatedAt: null,
      deactivatedAt: now,
    },
    update: {
      availabilityStatus: "disabled",
      updatedByPubkey: input.actorPubkey ?? null,
      availabilityExpiresAt: null,
      deactivatedAt: now,
    },
  }));
}

export async function consumeCircleGovernanceCommitteeReceiveWindow(
  prisma: Pick<CircleCommitteeProfilePrisma, "circleGovernanceCommitteeProfile">,
  input: {
    circleId: number;
    mandateRequestId: string;
    now?: Date;
  },
): Promise<CircleGovernanceCommitteeProfileRecord> {
  const now = input.now ?? new Date();
  const result = await prisma.circleGovernanceCommitteeProfile.updateMany({
    where: {
      circleId: input.circleId,
      availabilityStatus: "enabled",
      availabilityExpiresAt: { gt: now },
      lastMandateRequestId: null,
    },
    data: {
      availabilityStatus: "disabled",
      availabilityExpiresAt: null,
      lastMandateRequestId: input.mandateRequestId,
      lastMandateRequestAt: now,
      deactivatedAt: now,
    },
  });
  if (result.count !== 1) {
    throw new Error("circle_governance_committee_receive_window_consumed");
  }
  const profile = await prisma.circleGovernanceCommitteeProfile.findUnique({
    where: { circleId: input.circleId },
  });
  return normalizeProfile(input.circleId, profile);
}

export function committeeReceiveWindowAcceptsActionScope(
  profile: Pick<
    CircleGovernanceCommitteeProfileRecord,
    "availabilityStatus" | "availabilityExpiresAt" | "allowedActionPrefixes"
  >,
  actionScope: string,
  now: Date = new Date(),
): boolean {
  if (profile.availabilityStatus !== "enabled") return false;
  if (!profile.availabilityExpiresAt || profile.availabilityExpiresAt <= now) return false;
  const prefixes = normalizeStoredAllowedActionPrefixes(profile.allowedActionPrefixes);
  if (!prefixes) return false;
  return prefixes.some((prefix) =>
    actionScope === prefix || actionScope.startsWith(`${prefix}.`)
  );
}

async function assertCircleCanReceiveGovernanceMandates(
  prisma: CircleCommitteeProfilePrisma,
  circleId: number,
): Promise<number> {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, lifecycleStatus: true },
  }) as { id: number; lifecycleStatus?: string | null } | null;
  if (!circle) {
    throw new Error("circle_governance_committee_not_found");
  }
  if (circle.lifecycleStatus && circle.lifecycleStatus !== "Active") {
    throw new Error("circle_governance_committee_not_active");
  }
  const eligibleActors = await listCommitteeEligibleActors(prisma, {
    committeeCircleId: circleId,
  });
  if (eligibleActors.length === 0) {
    throw new Error("governance_committee_eligible_members_required");
  }
  return eligibleActors.length;
}

function isProfileExpired(
  profile: CircleGovernanceCommitteeProfileRecord,
  now: Date,
): boolean {
  if (profile.availabilityStatus !== "enabled") return false;
  return !profile.availabilityExpiresAt || profile.availabilityExpiresAt <= now;
}

function normalizeProfile(
  circleId: number,
  value: unknown,
): CircleGovernanceCommitteeProfileRecord {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    circleId: normalizeInteger(record.circleId, circleId),
    availabilityStatus: record.availabilityStatus === "enabled"
      ? "enabled"
      : "disabled",
    allowedActionPrefixes: normalizeStoredAllowedActionPrefixes(record.allowedActionPrefixes),
    defaultStrategy: normalizeString(record.defaultStrategy) ?? "committee.member_threshold",
    electorateTemplate: normalizeCircleGovernanceCommitteeElectorateTemplate(record.electorateTemplate),
    windowMinutes: normalizeNullableInteger(record.windowMinutes),
    updatedByPubkey: normalizeString(record.updatedByPubkey),
    availabilityOpenedAt: normalizeDate(record.availabilityOpenedAt),
    availabilityExpiresAt: normalizeDate(record.availabilityExpiresAt),
    lastMandateRequestId: normalizeString(record.lastMandateRequestId),
    lastMandateRequestAt: normalizeDate(record.lastMandateRequestAt),
    activatedAt: normalizeDate(record.activatedAt),
    deactivatedAt: normalizeDate(record.deactivatedAt),
    createdAt: normalizeDate(record.createdAt),
    updatedAt: normalizeDate(record.updatedAt),
  };
}

export function normalizeCircleGovernanceCommitteeElectorateTemplate(
  value: unknown,
  eligibleActorCount?: number,
): CircleGovernanceCommitteeElectorateTemplate {
  if (value == null) {
    return {
      source: DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE.source,
      weight: { ...DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE.weight },
      threshold: { ...DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE.threshold },
      ballotDisclosure: { ...DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE.ballotDisclosure },
      quadraticVoiceCredits: { ...DEFAULT_COMMITTEE_ELECTORATE_TEMPLATE.quadraticVoiceCredits },
    };
  }
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const weight = record.weight && typeof record.weight === "object" && !Array.isArray(record.weight)
    ? record.weight as Record<string, unknown>
    : {};
  const threshold = record.threshold && typeof record.threshold === "object" && !Array.isArray(record.threshold)
    ? record.threshold as Record<string, unknown>
    : {};
  const ballotDisclosure = record.ballotDisclosure
    && typeof record.ballotDisclosure === "object"
    && !Array.isArray(record.ballotDisclosure)
    ? record.ballotDisclosure as Record<string, unknown>
    : {};
  const quadraticVoiceCredits = record.quadraticVoiceCredits
    && typeof record.quadraticVoiceCredits === "object"
    && !Array.isArray(record.quadraticVoiceCredits)
    ? record.quadraticVoiceCredits as Record<string, unknown>
    : {};
  const mode = threshold.mode;
  const disclosureMode = ballotDisclosure.mode;
  const fixedValue = Number(threshold.value);
  const budgetPerActor = quadraticVoiceCredits.budgetPerActor == null
    ? null
    : Number(quadraticVoiceCredits.budgetPerActor);
  if (
    record.source !== "active_committee_members"
    || weight.mode !== "equal_one"
    || (mode !== "default_majority" && mode !== "fixed_count" && mode !== "unanimity")
    || (mode === "fixed_count" && (
      !Number.isSafeInteger(fixedValue)
      || fixedValue < 1
      || (eligibleActorCount != null && fixedValue > eligibleActorCount)
    ))
    || (mode !== "fixed_count" && threshold.value != null)
    || (
      disclosureMode !== "public"
      && disclosureMode !== "member"
      && disclosureMode !== "eligible_only"
      && disclosureMode !== "aggregate_until_close"
      && disclosureMode !== "provider_defined"
    )
    || (budgetPerActor !== null && (
      !Number.isSafeInteger(budgetPerActor)
      || budgetPerActor < 1
      || budgetPerActor > 1_000_000
    ))
  ) {
    throw new Error("invalid_committee_electorate_template");
  }
  return {
    source: "active_committee_members",
    weight: { mode: "equal_one" },
    threshold: {
      mode,
      value: mode === "fixed_count" ? fixedValue : null,
    },
    ballotDisclosure: { mode: disclosureMode },
    quadraticVoiceCredits: { budgetPerActor },
  };
}

function normalizeWindowMinutes(value: unknown): number {
  if (value == null) return DEFAULT_COMMITTEE_RECEIVE_WINDOW_MINUTES;
  const parsed = Math.floor(Number(value));
  const base = Number.isFinite(parsed)
    ? parsed
    : DEFAULT_COMMITTEE_RECEIVE_WINDOW_MINUTES;
  return Math.max(
    MIN_COMMITTEE_RECEIVE_WINDOW_MINUTES,
    Math.min(MAX_COMMITTEE_RECEIVE_WINDOW_MINUTES, base),
  );
}

function normalizeAllowedActionPrefixes(value: unknown): string[] {
  if (value == null) return [...DEFAULT_COMMITTEE_RECEIVE_WINDOW_PREFIXES];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("invalid_committee_receive_window_scope");
  }
  const prefixes = Array.from(new Set(value.map((item) => String(item || "").trim())))
    .filter(Boolean);
  if (
    prefixes.length === 0 ||
    prefixes.some((prefix) => !COMMITTEE_RECEIVE_WINDOW_PREFIXES.includes(prefix as any))
  ) {
    throw new Error("invalid_committee_receive_window_scope");
  }
  return prefixes;
}

function normalizeStoredAllowedActionPrefixes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const prefixes = value.map((item) => String(item || "").trim()).filter(Boolean);
  return prefixes.length > 0 ? prefixes : null;
}

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeNullableInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
