import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { syncCircleLocationDiscoveryIndex } from "./syncDiscoveryIndex";
import { toIsoStringOrNull } from "./privacy";
import {
  normalizeCircleGeoAnchorArchiveInput,
  normalizeCircleGeoAnchorInput,
} from "./validation";
import type {
  CircleGeoAnchorArchiveInput,
  CircleGeoAnchorDto,
  CircleGeoAnchorInput,
} from "./types";

export interface CirclePrimaryGeoAnchorWriteContext {
  circleId: number;
  actorPubkey?: string | null;
  governanceRequestId?: string | null;
  now?: Date;
}

export async function upsertCirclePrimaryGeoAnchor(
  prisma: PrismaClient | Record<string, unknown>,
  context: CirclePrimaryGeoAnchorWriteContext,
  rawInput: CircleGeoAnchorInput | Record<string, unknown>,
): Promise<CircleGeoAnchorDto> {
  const input = normalizeCircleGeoAnchorInput(rawInput);
  const now = context.now ?? new Date();
  const run = async (tx: any) => {
    const previous = await tx.circleGeoAnchor.findFirst({
      where: {
        circleId: context.circleId,
        role: "primary",
        status: { in: ["draft", "active"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    const anchorId = previous?.anchorId ?? buildCirclePrimaryAnchorId(context.circleId);
    const anchor = await tx.circleGeoAnchor.upsert({
      where: { anchorId },
      create: {
        anchorId,
        circleId: context.circleId,
        role: input.role,
        geometryType: input.geometryType,
        label: input.label,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        radiusMeters: input.radiusMeters,
        visibility: input.visibility,
        status: "active",
        source: input.source,
        createdByPubkey: context.actorPubkey ?? null,
        updatedByPubkey: context.actorPubkey ?? null,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      },
      update: {
        role: input.role,
        geometryType: input.geometryType,
        label: input.label,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        radiusMeters: input.radiusMeters,
        visibility: input.visibility,
        status: "active",
        source: input.source,
        updatedByPubkey: context.actorPubkey ?? null,
        metadata: input.metadata,
        updatedAt: now,
        archivedAt: null,
      },
    });
    await tx.circleGeoAnchorAuditEvent.create({
      data: {
        eventId: randomUUID(),
        anchorId,
        circleId: context.circleId,
        actorPubkey: context.actorPubkey ?? null,
        eventType: previous ? "updated" : "created",
        previousValue: previous ? serializeAnchorForAudit(previous) : undefined,
        nextValue: serializeAnchorForAudit(anchor),
        governanceRequestId: context.governanceRequestId ?? null,
        createdAt: now,
      },
    });
    await syncCircleLocationDiscoveryIndex(tx, {
      anchorId,
      reason: "upsert_anchor",
    });
    return anchor;
  };
  const anchor = await runInTransaction(prisma, run);
  return publicCircleGeoAnchor(anchor);
}

export async function archiveCirclePrimaryGeoAnchor(
  prisma: PrismaClient | Record<string, unknown>,
  context: CirclePrimaryGeoAnchorWriteContext,
  rawInput: CircleGeoAnchorArchiveInput | Record<string, unknown>,
): Promise<CircleGeoAnchorDto | null> {
  const input = normalizeCircleGeoAnchorArchiveInput(rawInput);
  const now = context.now ?? new Date();
  const run = async (tx: any) => {
    const anchor = input.anchorId
      ? await tx.circleGeoAnchor.findFirst({
        where: {
          anchorId: input.anchorId,
          circleId: context.circleId,
          role: "primary",
          status: { in: ["draft", "active"] },
        },
      })
      : await tx.circleGeoAnchor.findFirst({
        where: {
          circleId: context.circleId,
          role: "primary",
          status: { in: ["draft", "active"] },
        },
        orderBy: { updatedAt: "desc" },
      });
    if (!anchor) return null;
    const archived = await tx.circleGeoAnchor.update({
      where: { anchorId: anchor.anchorId },
      data: {
        status: "archived",
        updatedByPubkey: context.actorPubkey ?? null,
        updatedAt: now,
        archivedAt: now,
      },
    });
    await tx.circleGeoAnchorAuditEvent.create({
      data: {
        eventId: randomUUID(),
        anchorId: archived.anchorId,
        circleId: context.circleId,
        actorPubkey: context.actorPubkey ?? null,
        eventType: "archived",
        previousValue: serializeAnchorForAudit(anchor),
        nextValue: serializeAnchorForAudit(archived),
        governanceRequestId: context.governanceRequestId ?? null,
        createdAt: now,
      },
    });
    await syncCircleLocationDiscoveryIndex(tx, {
      anchorId: archived.anchorId,
      reason: "archive_anchor",
    });
    return archived;
  };
  const anchor = await runInTransaction(prisma, run);
  return anchor ? publicCircleGeoAnchor(anchor) : null;
}

export async function fetchCirclePrimaryGeoAnchor(
  prisma: PrismaClient | Record<string, unknown>,
  circleId: number,
): Promise<CircleGeoAnchorDto | null> {
  const anchor = await (prisma as any).circleGeoAnchor.findFirst({
    where: {
      circleId,
      role: "primary",
      status: { in: ["draft", "active"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  return anchor ? publicCircleGeoAnchor(anchor) : null;
}

export function buildCirclePrimaryAnchorId(circleId: number): string {
  return `circle_geo_anchor_${circleId}_primary`;
}

function publicCircleGeoAnchor(anchor: any): CircleGeoAnchorDto {
  return {
    anchorId: String(anchor.anchorId),
    circleId: Number(anchor.circleId),
    role: anchor.role,
    geometryType: anchor.geometryType,
    label: String(anchor.label),
    centerLat: Number(anchor.centerLat),
    centerLng: Number(anchor.centerLng),
    radiusMeters: Number(anchor.radiusMeters),
    visibility: anchor.visibility,
    status: anchor.status,
    source: anchor.source,
    createdAt: toIsoStringOrNull(anchor.createdAt),
    updatedAt: toIsoStringOrNull(anchor.updatedAt),
    archivedAt: toIsoStringOrNull(anchor.archivedAt),
  };
}

function serializeAnchorForAudit(anchor: any): Record<string, unknown> {
  return {
    anchorId: anchor.anchorId,
    circleId: anchor.circleId,
    role: anchor.role,
    geometryType: anchor.geometryType,
    label: anchor.label,
    centerLat: Number(anchor.centerLat),
    centerLng: Number(anchor.centerLng),
    radiusMeters: Number(anchor.radiusMeters),
    visibility: anchor.visibility,
    status: anchor.status,
    source: anchor.source,
    updatedAt: toIsoStringOrNull(anchor.updatedAt),
    archivedAt: toIsoStringOrNull(anchor.archivedAt),
  };
}

async function runInTransaction<T>(
  prisma: PrismaClient | Record<string, unknown>,
  run: (tx: any) => Promise<T>,
): Promise<T> {
  const client = prisma as any;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx: any) => run(tx));
  }
  return run(client);
}
