import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { publishCircleLifecycleSystemNotice } from "../discussion/systemNoticeProducer";

export type CircleLifecycleAction = "archive" | "restore" | "dissolve";
export type CircleLifecycleActionType =
  | "circle.lifecycle.archive"
  | "circle.lifecycle.restore"
  | "circle.lifecycle.dissolve";

export interface CircleLifecycleExecutionResult {
  actionType: CircleLifecycleActionType;
  circle: {
    id: number;
    lifecycleStatus: string;
    archivedAt: Date | string | null;
    archivedByPubkey: string | null;
    archiveReason: string | null;
  };
}

export function normalizeCircleLifecycleAction(
  value: unknown,
): CircleLifecycleAction | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "archive") return "archive";
  if (normalized === "restore") return "restore";
  if (normalized === "dissolve") return "dissolve";
  return null;
}

export function circleLifecycleActionType(
  action: CircleLifecycleAction,
): CircleLifecycleActionType {
  if (action === "restore") return "circle.lifecycle.restore";
  if (action === "dissolve") return "circle.lifecycle.dissolve";
  return "circle.lifecycle.archive";
}

export function normalizeCircleLifecycleActionType(
  actionType: unknown,
): CircleLifecycleAction | null {
  const normalized = String(actionType || "").trim();
  if (normalized === "circle.lifecycle.archive") return "archive";
  if (normalized === "circle.lifecycle.restore") return "restore";
  if (normalized === "circle.lifecycle.dissolve") return "dissolve";
  return null;
}

export async function executeCircleLifecycleAction(
  prisma: Pick<PrismaClient, "circle">,
  redis: Pick<Redis, "del" | "publish"> | null | undefined,
  input: {
    circleId: number;
    action: CircleLifecycleAction;
    actorPubkey: string;
    reason?: string | null;
    now?: Date;
  },
): Promise<CircleLifecycleExecutionResult> {
  if (input.action === "dissolve") {
    throw new Error("circle_lifecycle_dissolve_unavailable");
  }
  const actionType = circleLifecycleActionType(input.action);
  const existing = await prisma.circle.findUnique({
    where: { id: input.circleId },
    select: {
      id: true,
      lifecycleStatus: true,
      archivedAt: true,
      archivedByPubkey: true,
      archiveReason: true,
    },
  });
  if (!existing) {
    throw new Error("circle_not_found");
  }

  const desiredLifecycleStatus = input.action === "restore" ? "Active" : "Archived";
  if (String(existing.lifecycleStatus) === desiredLifecycleStatus) {
    return {
      actionType,
      circle: {
        id: existing.id,
        lifecycleStatus: String(existing.lifecycleStatus),
        archivedAt: existing.archivedAt ?? null,
        archivedByPubkey: existing.archivedByPubkey ?? null,
        archiveReason: existing.archiveReason ?? null,
      },
    };
  }

  const now = input.now ?? new Date();
  const reason = normalizeReason(input.reason);
  const updated = await prisma.circle.update({
    where: { id: input.circleId },
    data: input.action === "restore"
      ? {
          lifecycleStatus: "Active",
          archivedAt: null,
          archivedByPubkey: null,
          archiveReason: null,
        }
      : {
          lifecycleStatus: "Archived",
          archivedAt: now,
          archivedByPubkey: input.actorPubkey,
          archiveReason: reason,
        },
    select: {
      id: true,
      lifecycleStatus: true,
      archivedAt: true,
      archivedByPubkey: true,
      archiveReason: true,
    },
  });

  await invalidateCircleCache(redis, input.circleId);
  await publishLifecycleNoticeSafely(prisma as PrismaClient, redis, {
    circleId: input.circleId,
    actionType,
    lifecycleStatus: String(updated.lifecycleStatus),
    actorPubkey: input.actorPubkey,
    reason,
  });

  return {
    actionType,
    circle: {
      id: updated.id,
      lifecycleStatus: String(updated.lifecycleStatus),
      archivedAt: updated.archivedAt ?? null,
      archivedByPubkey: updated.archivedByPubkey ?? null,
      archiveReason: updated.archiveReason ?? null,
    },
  };
}

async function invalidateCircleCache(
  redis: Pick<Redis, "del" | "publish"> | null | undefined,
  circleId: number,
): Promise<void> {
  if (!redis) return;
  const key = `circle:${circleId}`;
  if (typeof redis.del === "function") {
    await redis.del(key);
  }
  if (typeof redis.publish === "function") {
    await redis.publish(
      "cache:invalidation",
      JSON.stringify({ type: "invalidation", key }),
    );
  }
}

async function publishLifecycleNoticeSafely(
  prisma: PrismaClient,
  redis: Pick<Redis, "publish"> | null | undefined,
  input: {
    circleId: number;
    actionType: string;
    lifecycleStatus: string;
    actorPubkey: string;
    reason: string | null;
  },
): Promise<void> {
  if (
    typeof (prisma as any)?.$queryRaw !== "function" ||
    typeof (prisma as any)?.$transaction !== "function"
  ) {
    return;
  }
  try {
    await publishCircleLifecycleSystemNotice(prisma, input, redis);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`circle lifecycle: failed to publish system notice (${message})`);
  }
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, 280);
  return normalized || null;
}
