import type {
  CircleGeoAnchorArchiveInput,
  CircleGeoAnchorInput,
  CircleGeoAnchorSettingsPayload,
  CircleGeoAnchorSource,
  CircleGeoAnchorVisibility,
  NearbyCircleLocationInput,
  NormalizedCircleGeoAnchorInput,
  NormalizedNearbyCircleLocationInput,
} from "./types";

const ANCHOR_RADIUS_MIN_METERS = 25;
const ANCHOR_RADIUS_MAX_METERS = 3000;
const DISCOVERY_RADIUS_MIN_METERS = 500;
const DISCOVERY_RADIUS_MAX_METERS = 50000;
const DISCOVERY_LIMIT_DEFAULT = 30;
const DISCOVERY_LIMIT_MAX = 50;

const VISIBILITIES = new Set<CircleGeoAnchorVisibility>([
  "public_discovery",
  "members_only",
  "managers_only",
]);

const SOURCES = new Set<CircleGeoAnchorSource>(["manual", "current_location"]);

export function normalizeCircleGeoAnchorInput(
  raw: unknown,
): NormalizedCircleGeoAnchorInput {
  const input = normalizeRecord(raw);
  if (input.operation !== "upsert") {
    throw new Error("invalid_circle_geo_anchor_operation");
  }
  const label = normalizeAnchorLabel(input.label);
  const centerLat = normalizeLatitude(input.centerLat, "invalid_circle_geo_anchor_latitude");
  const centerLng = normalizeLongitude(input.centerLng, "invalid_circle_geo_anchor_longitude");
  const radiusMeters = normalizeInteger(input.radiusMeters, "invalid_circle_geo_anchor_radius");
  if (
    radiusMeters < ANCHOR_RADIUS_MIN_METERS ||
    radiusMeters > ANCHOR_RADIUS_MAX_METERS
  ) {
    throw new Error("invalid_circle_geo_anchor_radius");
  }
  const visibility = normalizeVisibility(input.visibility);
  const source = normalizeSource(input.source);
  return {
    operation: "upsert",
    role: "primary",
    geometryType: "point_radius",
    label,
    centerLat,
    centerLng,
    radiusMeters,
    visibility,
    source,
    metadata: normalizeMetadata(input.metadata),
  };
}

export function normalizeCircleGeoAnchorArchiveInput(
  raw: unknown,
): CircleGeoAnchorArchiveInput {
  const input = normalizeRecord(raw);
  if (input.operation !== "archive") {
    throw new Error("invalid_circle_geo_anchor_operation");
  }
  const anchorId = normalizeOptionalAnchorId(input.anchorId);
  return anchorId
    ? { operation: "archive", anchorId }
    : { operation: "archive" };
}

export function normalizeCircleGeoAnchorSettingsPayload(
  raw: unknown,
): CircleGeoAnchorSettingsPayload {
  const input = normalizeRecord(raw);
  if (input.operation === "archive") {
    return normalizeCircleGeoAnchorArchiveInput(input);
  }
  const normalized = normalizeCircleGeoAnchorInput(input);
  return {
    operation: "upsert",
    label: normalized.label,
    centerLat: normalized.centerLat,
    centerLng: normalized.centerLng,
    radiusMeters: normalized.radiusMeters,
    visibility: normalized.visibility,
  } satisfies CircleGeoAnchorInput;
}

export function normalizeNearbyCircleLocationInput(
  raw: NearbyCircleLocationInput,
): NormalizedNearbyCircleLocationInput {
  const input = normalizeRecord(raw);
  const centerLat = normalizeLatitude(input.centerLat, "invalid_location_discovery_latitude");
  const centerLng = normalizeLongitude(input.centerLng, "invalid_location_discovery_longitude");
  const radiusMeters = normalizeInteger(input.radiusMeters, "invalid_location_discovery_radius");
  if (
    radiusMeters < DISCOVERY_RADIUS_MIN_METERS ||
    radiusMeters > DISCOVERY_RADIUS_MAX_METERS
  ) {
    throw new Error("invalid_location_discovery_radius");
  }
  const rawLimit = input.limit === undefined
    ? DISCOVERY_LIMIT_DEFAULT
    : normalizeInteger(input.limit, "invalid_location_discovery_limit");
  if (rawLimit < 1 || rawLimit > DISCOVERY_LIMIT_MAX) {
    throw new Error("invalid_location_discovery_limit");
  }
  return {
    centerLat,
    centerLng,
    radiusMeters,
    limit: rawLimit,
  };
}

function normalizeAnchorLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("invalid_circle_geo_anchor_label");
  }
  const label = value.trim().replace(/\s+/g, " ");
  if (label.length < 1 || label.length > 128) {
    throw new Error("invalid_circle_geo_anchor_label");
  }
  if (/https?:\/\//i.test(label) || /\bwww\./i.test(label)) {
    throw new Error("invalid_circle_geo_anchor_label");
  }
  const digits = label.replace(/\D/g, "");
  const compact = label.replace(/\s/g, "");
  if (digits.length >= 7 && digits.length / Math.max(compact.length, 1) > 0.55) {
    throw new Error("invalid_circle_geo_anchor_label");
  }
  return label;
}

function normalizeVisibility(value: unknown): CircleGeoAnchorVisibility {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "public_discovery";
  if (!VISIBILITIES.has(normalized as CircleGeoAnchorVisibility)) {
    throw new Error("invalid_circle_geo_anchor_visibility");
  }
  return normalized as CircleGeoAnchorVisibility;
}

function normalizeSource(value: unknown): CircleGeoAnchorSource {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "manual";
  if (!SOURCES.has(normalized as CircleGeoAnchorSource)) {
    throw new Error("invalid_circle_geo_anchor_source");
  }
  return normalized as CircleGeoAnchorSource;
}

function normalizeLatitude(value: unknown, errorCode: string): number {
  const parsed = normalizeNumber(value, errorCode);
  if (parsed < -90 || parsed > 90) throw new Error(errorCode);
  return parsed;
}

function normalizeLongitude(value: unknown, errorCode: string): number {
  const parsed = normalizeNumber(value, errorCode);
  if (parsed < -180 || parsed > 180) throw new Error(errorCode);
  return parsed;
}

function normalizeNumber(value: unknown, errorCode: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return parsed;
}

function normalizeInteger(value: unknown, errorCode: string): number {
  const parsed = normalizeNumber(value, errorCode);
  if (!Number.isInteger(parsed)) throw new Error(errorCode);
  return parsed;
}

function normalizeOptionalAnchorId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error("invalid_circle_geo_anchor_id");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || !/^[a-zA-Z0-9:_-]+$/.test(normalized)) {
    throw new Error("invalid_circle_geo_anchor_id");
  }
  return normalized;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_circle_geo_anchor_metadata");
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_circle_location_payload");
  }
  return value as Record<string, unknown>;
}
