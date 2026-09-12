import type { PrismaClient } from "@prisma/client";

export type CircleLocationDiscoverySyncReason =
  | "upsert_anchor"
  | "archive_anchor"
  | "circle_visibility_refresh";

export async function syncCircleLocationDiscoveryIndex(
  prisma: PrismaClient | Record<string, unknown>,
  input: {
    anchorId: string;
    reason: CircleLocationDiscoverySyncReason;
  },
): Promise<void> {
  const client = prisma as any;
  const anchor = await client.circleGeoAnchor.findUnique({
    where: { anchorId: input.anchorId },
    include: { circle: true },
  });
  if (!isDiscoverableAnchor(anchor)) {
    await client.circleLocationDiscoveryIndex.deleteMany({
      where: { anchorId: input.anchorId },
    });
    return;
  }

  const row = {
    anchorId: anchor.anchorId,
    circleId: anchor.circleId,
    role: anchor.role,
    geometryType: anchor.geometryType,
    label: anchor.label,
    centerLat: anchor.centerLat,
    centerLng: anchor.centerLng,
    radiusMeters: anchor.radiusMeters,
    visibility: anchor.visibility,
    status: anchor.status,
    rankHints: {},
    updatedAt: new Date(),
  };
  await client.circleLocationDiscoveryIndex.upsert({
    where: { anchorId: anchor.anchorId },
    create: row,
    update: {
      circleId: row.circleId,
      role: row.role,
      geometryType: row.geometryType,
      label: row.label,
      centerLat: row.centerLat,
      centerLng: row.centerLng,
      radiusMeters: row.radiusMeters,
      visibility: row.visibility,
      status: row.status,
      rankHints: row.rankHints,
      updatedAt: row.updatedAt,
    },
  });
}

function isDiscoverableAnchor(anchor: any): boolean {
  return Boolean(
    anchor &&
      anchor.role === "primary" &&
      anchor.geometryType === "point_radius" &&
      anchor.status === "active" &&
      anchor.visibility === "public_discovery" &&
      anchor.circle?.lifecycleStatus === "Active",
  );
}
