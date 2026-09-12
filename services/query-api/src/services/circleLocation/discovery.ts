import { Prisma, type PrismaClient } from "@prisma/client";

import { roundDistanceToTenMeters, toIsoStringOrNull } from "./privacy";
import {
  normalizeNearbyCircleLocationInput,
} from "./validation";
import type {
  NearbyCircleLocationDto,
  NearbyCircleLocationInput,
  NearbyCircleLocationResult,
} from "./types";

interface NearbyCircleLocationRow {
  anchorId: string;
  circleId: number | string;
  circleName: string;
  circleDescription: string | null;
  membersCount: number | string | bigint | null;
  postsCount: number | string | bigint | null;
  label: string;
  radiusMeters: number | string;
  distanceMeters: number | string;
  bearingDegrees: number | string | null;
  updatedAt: Date | string | null;
}

export async function findNearbyCircleLocations(
  prisma: PrismaClient | Record<string, unknown>,
  rawInput: NearbyCircleLocationInput,
): Promise<NearbyCircleLocationResult> {
  const input = normalizeNearbyCircleLocationInput(rawInput);
  const rows = await (prisma as any).$queryRaw(Prisma.sql`
    WITH origin AS (
      SELECT
        ST_SetSRID(
          ST_MakePoint(${input.centerLng}::double precision, ${input.centerLat}::double precision),
          4326
        ) AS geom,
        ST_SetSRID(
        ST_MakePoint(${input.centerLng}::double precision, ${input.centerLat}::double precision),
        4326
        )::geography AS geog
    )
    SELECT
      i.anchor_id AS "anchorId",
      i.circle_id AS "circleId",
      c.name AS "circleName",
      c.description AS "circleDescription",
      c.members_count AS "membersCount",
      c.posts_count AS "postsCount",
      i.label AS "label",
      i.radius_meters AS "radiusMeters",
      ST_Distance(
        ST_SetSRID(
          ST_MakePoint(i.center_lng::double precision, i.center_lat::double precision),
          4326
        )::geography,
        origin.geog
      ) AS "distanceMeters",
      DEGREES(ST_Azimuth(
        origin.geom,
        ST_SetSRID(
          ST_MakePoint(i.center_lng::double precision, i.center_lat::double precision),
          4326
        )
      )) AS "bearingDegrees",
      i.updated_at AS "updatedAt"
    FROM circle_location_discovery_index i
    JOIN circles c ON c.id = i.circle_id
    CROSS JOIN origin
    WHERE i.status = 'active'
      AND i.visibility = 'public_discovery'
      AND c.lifecycle_status = 'Active'
      AND ST_DWithin(
        ST_SetSRID(
          ST_MakePoint(i.center_lng::double precision, i.center_lat::double precision),
          4326
        )::geography,
        origin.geog,
        ${input.radiusMeters}::double precision
      )
    ORDER BY "distanceMeters" ASC, c.members_count DESC
    LIMIT ${input.limit}
  `) as NearbyCircleLocationRow[];

  return {
    items: rows.map(mapNearbyCircleLocationRow),
  };
}

function mapNearbyCircleLocationRow(
  row: NearbyCircleLocationRow,
): NearbyCircleLocationDto {
  return {
    anchorId: String(row.anchorId),
    circleId: Number(row.circleId),
    circleName: String(row.circleName),
    circleDescription: row.circleDescription ? String(row.circleDescription) : null,
    membersCount: Number(row.membersCount ?? 0),
    postsCount: Number(row.postsCount ?? 0),
    label: String(row.label),
    radiusMeters: Number(row.radiusMeters),
    distanceMeters: roundDistanceToTenMeters(row.distanceMeters),
    bearingDegrees: normalizeBearingDegrees(row.bearingDegrees),
    updatedAt: toIsoStringOrNull(row.updatedAt),
  };
}

function normalizeBearingDegrees(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(((parsed % 360) + 360) % 360);
}
