export type CircleGeoAnchorRole = "primary" | "secondary";
export type CircleGeoAnchorGeometryType =
  | "point_radius"
  | "polygon"
  | "polyline_corridor";
export type CircleGeoAnchorVisibility =
  | "public_discovery"
  | "members_only"
  | "managers_only";
export type CircleGeoAnchorStatus = "draft" | "active" | "archived";
export type CircleGeoAnchorSource = "manual" | "current_location";

export interface CircleGeoAnchorInput {
  operation: "upsert";
  label: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  visibility: CircleGeoAnchorVisibility;
}

export interface NormalizedCircleGeoAnchorInput extends CircleGeoAnchorInput {
  role: "primary";
  geometryType: "point_radius";
  source: CircleGeoAnchorSource;
  metadata: Record<string, unknown>;
}

export interface CircleGeoAnchorArchiveInput {
  operation: "archive";
  anchorId?: string;
}

export type CircleGeoAnchorSettingsPayload =
  | CircleGeoAnchorInput
  | CircleGeoAnchorArchiveInput;

export interface NearbyCircleLocationInput {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  limit?: number;
}

export interface NormalizedNearbyCircleLocationInput
  extends Required<NearbyCircleLocationInput> {}

export interface CircleGeoAnchorDto {
  anchorId: string;
  circleId: number;
  role: CircleGeoAnchorRole;
  geometryType: CircleGeoAnchorGeometryType;
  label: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  visibility: CircleGeoAnchorVisibility;
  status: CircleGeoAnchorStatus;
  source: CircleGeoAnchorSource | string;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
}

export interface NearbyCircleLocationDto {
  anchorId: string;
  circleId: number;
  circleName: string;
  circleDescription: string | null;
  membersCount: number;
  postsCount: number;
  label: string;
  radiusMeters: number;
  distanceMeters: number;
  bearingDegrees: number;
  updatedAt: string | null;
}

export interface NearbyCircleLocationResult {
  items: NearbyCircleLocationDto[];
}
