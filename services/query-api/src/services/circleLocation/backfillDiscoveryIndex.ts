import type { PrismaClient } from "@prisma/client";

import { syncCircleLocationDiscoveryIndex } from "./syncDiscoveryIndex";

export async function backfillCircleLocationDiscoveryIndex(
  prisma: PrismaClient | Record<string, unknown>,
): Promise<{ scanned: number; synced: number }> {
  const client = prisma as any;
  const anchors = await client.circleGeoAnchor.findMany({
    where: { role: "primary", geometryType: "point_radius" },
    select: { anchorId: true },
    orderBy: { updatedAt: "desc" },
  });
  let synced = 0;
  for (const anchor of anchors) {
    await syncCircleLocationDiscoveryIndex(client, {
      anchorId: anchor.anchorId,
      reason: "circle_visibility_refresh",
    });
    synced += 1;
  }
  return { scanned: anchors.length, synced };
}
