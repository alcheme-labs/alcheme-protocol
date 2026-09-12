import { MemberRole, MemberStatus, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

export const CIRCLE_OWNER_TRANSFER_ACTION_TYPE = "circle.owner.transfer";
export const CIRCLE_OWNER_TRANSFER_EXECUTION_MODE = "off_chain";
export const CIRCLE_OWNER_TRANSFER_CHAIN_STATUS = "not_supported";

export interface CircleOwnerTransferPublicRecord {
  id: string;
  circleId: number;
  fromOwnerUserId: number;
  targetUserId: number;
  requestedByUserId: number;
  governanceRequestId: string | null;
  status: string;
  reason: string | null;
  executionMode: "off_chain";
  chainStatus: "not_supported";
  targetAcceptedAt: string | null;
  executedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CircleOwnerTransferExecutionResult {
  actionType: typeof CIRCLE_OWNER_TRANSFER_ACTION_TYPE;
  transfer: CircleOwnerTransferPublicRecord;
}

export function publicCircleOwnerTransferRequest(
  transfer: any,
): CircleOwnerTransferPublicRecord {
  return {
    id: String(transfer.id),
    circleId: Number(transfer.circleId),
    fromOwnerUserId: Number(transfer.fromOwnerUserId),
    targetUserId: Number(transfer.targetUserId),
    requestedByUserId: Number(transfer.requestedByUserId),
    governanceRequestId: transfer.governanceRequestId
      ? String(transfer.governanceRequestId)
      : null,
    status: String(transfer.status),
    reason: transfer.reason ? String(transfer.reason) : null,
    executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
    chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
    targetAcceptedAt: toIsoStringOrNull(transfer.targetAcceptedAt),
    executedAt: toIsoStringOrNull(transfer.executedAt),
    createdAt: toIsoStringOrNull(transfer.createdAt),
    updatedAt: toIsoStringOrNull(transfer.updatedAt),
  };
}

export async function executeCircleOwnerTransfer(
  prisma: Pick<PrismaClient, "$transaction">,
  redis: Pick<Redis, "del" | "publish"> | null | undefined,
  input: {
    transferRequestId: string;
    governanceRequestId?: string | null;
    acceptedAt?: Date | null;
    now?: Date;
  },
): Promise<CircleOwnerTransferExecutionResult> {
  const now = input.now ?? new Date();
  const transferId = String(input.transferRequestId || "").trim();
  if (!transferId) {
    throw new Error("invalid_owner_transfer_request_id");
  }

  const result = await (prisma as any).$transaction(async (tx: any) => {
    const transfer = await tx.circleOwnerTransferRequest.findUnique({
      where: { id: transferId },
    });
    if (!transfer) {
      throw new Error("owner_transfer_not_found");
    }

    if (String(transfer.status) === "executed") {
      return {
        actionType: CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
        transfer: publicCircleOwnerTransferRequest(transfer),
      };
    }

    if (
      String(transfer.status) !== "pending_target_acceptance" &&
      String(transfer.status) !== "pending_governance"
    ) {
      throw new Error("owner_transfer_not_executable");
    }

    const acceptedAt = transfer.targetAcceptedAt ?? input.acceptedAt ?? null;
    if (!acceptedAt) {
      throw new Error("owner_transfer_target_not_accepted");
    }

    const circleId = Number(transfer.circleId);
    const fromOwnerUserId = Number(transfer.fromOwnerUserId);
    const targetUserId = Number(transfer.targetUserId);
    if (!circleId || !fromOwnerUserId || !targetUserId || fromOwnerUserId === targetUserId) {
      throw new Error("invalid_owner_transfer_request");
    }

    const circle = await tx.circle.findUnique({
      where: { id: circleId },
      select: {
        id: true,
        creatorId: true,
        lifecycleStatus: true,
      },
    });
    if (!circle) {
      throw new Error("circle_not_found");
    }
    if (String(circle.lifecycleStatus) === "Archived") {
      throw new Error("owner_transfer_circle_archived");
    }
    if (String(circle.lifecycleStatus) !== "Active") {
      throw new Error("owner_transfer_circle_inactive");
    }
    if (Number(circle.creatorId) !== fromOwnerUserId) {
      throw new Error("owner_transfer_owner_changed");
    }

    const [oldOwnerMembership, targetMembership] = await Promise.all([
      tx.circleMember.findUnique({
        where: {
          circleId_userId: {
            circleId,
            userId: fromOwnerUserId,
          },
        },
      }),
      tx.circleMember.findUnique({
        where: {
          circleId_userId: {
            circleId,
            userId: targetUserId,
          },
        },
      }),
    ]);
    if (
      !oldOwnerMembership ||
      String(oldOwnerMembership.status) !== MemberStatus.Active ||
      String(oldOwnerMembership.role) !== MemberRole.Owner
    ) {
      throw new Error("owner_transfer_owner_membership_required");
    }
    if (
      !targetMembership ||
      String(targetMembership.status) !== MemberStatus.Active
    ) {
      throw new Error("owner_transfer_target_active_member_required");
    }
    if (String(targetMembership.role) === MemberRole.Owner) {
      throw new Error("owner_transfer_target_already_owner");
    }

    await tx.circle.update({
      where: { id: circleId },
      data: { creatorId: targetUserId },
    });
    await tx.circleMember.update({
      where: { id: oldOwnerMembership.id },
      data: { role: MemberRole.Moderator },
    });
    await tx.circleMember.update({
      where: { id: targetMembership.id },
      data: { role: MemberRole.Owner },
    });
    await tx.circleMembershipEvent.createMany({
      data: [
        {
          circleId,
          userId: fromOwnerUserId,
          actorUserId: fromOwnerUserId,
          eventType: "RoleChanged",
          roleBefore: oldOwnerMembership.role,
          roleAfter: MemberRole.Moderator,
          reason: transfer.reason ?? null,
          metadata: {
            transferRequestId: transfer.id,
            governanceRequestId: input.governanceRequestId ?? transfer.governanceRequestId ?? null,
            executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
            chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
          },
        },
        {
          circleId,
          userId: targetUserId,
          actorUserId: fromOwnerUserId,
          eventType: "RoleChanged",
          roleBefore: targetMembership.role,
          roleAfter: MemberRole.Owner,
          reason: transfer.reason ?? null,
          metadata: {
            transferRequestId: transfer.id,
            governanceRequestId: input.governanceRequestId ?? transfer.governanceRequestId ?? null,
            executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
            chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
          },
        },
      ],
    });
    const updatedTransfer = await tx.circleOwnerTransferRequest.update({
      where: { id: transfer.id },
      data: {
        status: "executed",
        targetAcceptedAt: acceptedAt,
        governanceRequestId: input.governanceRequestId ?? transfer.governanceRequestId ?? null,
        executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
        chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
        executedAt: now,
      },
    });

    return {
      actionType: CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
      transfer: publicCircleOwnerTransferRequest(updatedTransfer),
    };
  });
  await invalidateCircleAuthorityCache(redis, result.transfer.circleId);
  return result;
}

function toIsoStringOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function invalidateCircleAuthorityCache(
  redis: Pick<Redis, "del" | "publish"> | null | undefined,
  circleId: number,
): Promise<void> {
  if (!redis || !circleId) return;
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
