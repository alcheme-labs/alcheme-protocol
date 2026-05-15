import type { ExternalAppStabilityProjectionView } from "./stabilityTypes";

export type ExternalAppStoreSort = "latest" | "featured" | "trending";

export interface ExternalAppStoreProjectionView {
  externalAppId: string;
  policyEpochId: string;
  listingState: string;
  categoryTags: string[];
  searchText: string;
  rankingInputs: {
    reviewStatus: { value: string; contribution: number };
    riskScore: { value: number; contribution: number };
    trustScore: { value: number; contribution: number };
    usageRetention: { value: "unavailable"; contribution: 0; provenance: "unavailable" };
    disputeHistory: { value: string; contribution: number };
    supportSignal: { rawValue: number; cappedValue: number; contribution: number };
    externalRoute: { declared: boolean; contribution: 0 };
  };
  rankingOutput: { score: number; provenance: string[]; fallbackMode: boolean };
  featuredState: string;
  continuityLabels: string[];
  updatedAt: string;
}

export function buildExternalAppStoreProjection(input: {
  app: {
    id: string;
    name: string;
    discoveryStatus: string;
    managedNodePolicy: string;
    updatedAt: Date | string;
    config?: unknown;
  };
  stabilityProjection?: ExternalAppStabilityProjectionView | null;
  categoryTags?: string[];
  externalRouteDeclared?: boolean;
}): ExternalAppStoreProjectionView {
  const categoryTags = normalizeTags(input.categoryTags ?? extractCategoryTags(input.app.config));
  const supportSignal = Math.max(0, input.stabilityProjection?.supportSignalLevel ?? 0);
  const cappedSupport = Math.min(100, supportSignal);
  const riskScore = Math.max(0, input.stabilityProjection?.riskScore ?? 50);
  const trustScore = Math.max(0, input.stabilityProjection?.trustScore ?? 50);
  const disputeContribution =
    input.stabilityProjection?.challengeState === "dispute"
      ? -20
      : input.stabilityProjection?.challengeState === "review"
        ? -10
        : 0;
  const riskContribution = Math.max(-40, Math.min(0, -riskScore * 0.4));
  const trustContribution = Math.max(0, Math.min(35, trustScore * 0.35));
  const supportContribution = Math.max(0, Math.min(10, cappedSupport * 0.1));
  const reviewContribution = input.app.discoveryStatus === "listed" ? 20 : 8;
  const score =
    reviewContribution + trustContribution + riskContribution + supportContribution + disputeContribution;
  const externalRouteDeclared = Boolean(input.externalRouteDeclared);

  return {
    externalAppId: input.app.id,
    policyEpochId: input.stabilityProjection?.policyEpochId ?? "v3a-fallback",
    listingState: deriveListingState(input.app.discoveryStatus, input.stabilityProjection),
    categoryTags,
    searchText: [input.app.name, input.app.id, ...categoryTags]
      .join(" ")
      .trim()
      .toLowerCase(),
    rankingInputs: {
      reviewStatus: { value: input.app.discoveryStatus, contribution: reviewContribution },
      riskScore: { value: riskScore, contribution: riskContribution },
      trustScore: { value: trustScore, contribution: trustContribution },
      usageRetention: { value: "unavailable", contribution: 0, provenance: "unavailable" },
      disputeHistory: {
        value: input.stabilityProjection?.challengeState ?? "none",
        contribution: disputeContribution,
      },
      supportSignal: {
        rawValue: supportSignal,
        cappedValue: cappedSupport,
        contribution: supportContribution,
      },
      externalRoute: { declared: externalRouteDeclared, contribution: 0 },
    },
    rankingOutput: {
      score: Math.round(score * 1000) / 1000,
      provenance: ["v3a_store_projection"],
      fallbackMode: !input.stabilityProjection,
    },
    featuredState: score >= 50 && input.app.discoveryStatus === "listed" ? "candidate" : "none",
    continuityLabels: externalRouteDeclared ? ["App-Operated Node Declared"] : [],
    updatedAt: toIso(input.app.updatedAt),
  };
}

export function filterAndSortExternalAppStoreItems(
  items: ExternalAppStoreProjectionView[],
  input: { q?: string; category?: string; sort?: ExternalAppStoreSort; limit?: number },
): ExternalAppStoreProjectionView[] {
  const query = String(input.q || "").trim().toLowerCase();
  const category = String(input.category || "").trim().toLowerCase();
  const sort = input.sort ?? "latest";
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  return items
    .filter((item) => !query || item.searchText.includes(query))
    .filter((item) => !category || item.categoryTags.includes(category))
    .sort((a, b) => compareStoreItems(a, b, sort))
    .slice(0, limit);
}

function compareStoreItems(
  a: ExternalAppStoreProjectionView,
  b: ExternalAppStoreProjectionView,
  sort: ExternalAppStoreSort,
): number {
  if (sort === "featured" || sort === "trending") {
    const scoreDiff = b.rankingOutput.score - a.rankingOutput.score;
    if (scoreDiff !== 0) return scoreDiff;
  }
  return b.updatedAt.localeCompare(a.updatedAt) || a.externalAppId.localeCompare(b.externalAppId);
}

function deriveListingState(
  discoveryStatus: string,
  stabilityProjection?: ExternalAppStabilityProjectionView | null,
): string {
  if (discoveryStatus === "unlisted") return "unlisted";
  if (discoveryStatus === "limited") return "listed_limited";
  if (stabilityProjection?.projectionStatus === "projection_disputed") {
    return "listed_limited";
  }
  if (stabilityProjection?.rollout?.exposureBasisPoints !== undefined) {
    const exposure = Number(stabilityProjection.rollout.exposureBasisPoints);
    if (Number.isFinite(exposure) && exposure < 10_000) return "listed_sampled";
  }
  return "listed_full";
}

function extractCategoryTags(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const manifest = (config as Record<string, unknown>).manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  return normalizeTags((manifest as Record<string, unknown>).categoryTags);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 16),
    ),
  );
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
