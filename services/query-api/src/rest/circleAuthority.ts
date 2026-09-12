import { randomUUID } from "node:crypto";
import { Router } from "express";
import { MemberRole, MemberStatus, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { createGovernedActionRegistry } from "../services/governance/actionRegistry";
import {
  CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
  CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
  CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
  executeCircleOwnerTransfer,
  publicCircleOwnerTransferRequest,
} from "../services/governance/circleAuthority";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "../services/governance/circleGovernanceBindings";
import { GovernedActionGateway } from "../services/governance/governedActionGateway";
import { createPrismaGovernanceRequestStore } from "../services/governance/policyEngine";
import {
  requireAuthenticatedActor,
  requireCircleActorForAuthActor,
  requireCircleOwnerActor,
} from "../services/auth/actor";
import { sendAuthActorError } from "../services/auth/actorPermissions";

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, 280);
  return normalized.length > 0 ? normalized : null;
}

function publicRequest(request: any) {
  return {
    id: request.id,
    policyId: request.policyId,
    policyVersionId: request.policyVersionId,
    policyVersion: request.policyVersion,
    ruleId: request.ruleId,
    scopeType: request.scopeType,
    scopeRef: request.scopeRef,
    actionType: request.actionType,
    targetType: request.targetType,
    targetRef: request.targetRef,
    payload: request.payload ?? null,
    idempotencyKey: request.idempotencyKey,
    proposerPubkey: request.proposerPubkey,
    state: request.state,
    openedAt: request.openedAt instanceof Date ? request.openedAt.toISOString() : request.openedAt ?? null,
    expiresAt: request.expiresAt instanceof Date ? request.expiresAt.toISOString() : request.expiresAt ?? null,
    resolvedAt: request.resolvedAt instanceof Date ? request.resolvedAt.toISOString() : request.resolvedAt ?? null,
    snapshot: request.snapshot ?? null,
  };
}

async function resolveOwnerTransferSourceOwnerCapability(
  prisma: PrismaClient,
  input: { circleId: number; ownerUserId: number },
): Promise<{ ok: true; pubkey: string; directAllowed: boolean } | { ok: false; error: string }> {
  const owner = await prisma.user.findUnique({
    where: { id: input.ownerUserId },
    select: { id: true, pubkey: true },
  });
  if (!owner?.pubkey) {
    return { ok: false, error: "owner_transfer_owner_user_missing" };
  }

  // Domain fact for an existing transfer request. This is not current request authorization.
  const circle = await prisma.circle.findUnique({
    where: { id: input.circleId },
    select: { creatorId: true },
  });
  if (Number(circle?.creatorId) === input.ownerUserId) {
    return { ok: true, pubkey: owner.pubkey, directAllowed: true };
  }

  const membership = await prisma.circleMember.findUnique({
    where: {
      circleId_userId: {
        circleId: input.circleId,
        userId: input.ownerUserId,
      },
    },
    select: { role: true, status: true },
  });
  return {
    ok: true,
    pubkey: owner.pubkey,
    directAllowed: Boolean(
      membership &&
      String(membership.status) === MemberStatus.Active &&
      String(membership.role) === MemberRole.Owner,
    ),
  };
}

export function circleAuthorityRouter(prisma: PrismaClient, redis?: Redis | null): Router {
  const router = Router();

  router.get("/:circleId/authority/owner-transfer-requests", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      if (!circleId) {
        res.status(400).json({ error: "invalid_circle_id" });
        return;
      }
      const actor = await requireAuthenticatedActor(req, prisma as any, {
        requireSessionCookie: true,
      });
      const circleActor = await requireCircleActorForAuthActor(actor, prisma as any, {
        circleId,
        action: "circle.read",
        requireMemberChainPresence: false,
      });
      const actorUserId = actor.userId;
      const isOwner = circleActor.membership.role === "Owner";
      const where = isOwner
        ? {
            circleId,
            status: {
              in: ["pending_target_acceptance", "pending_governance", "executed"],
            },
          }
        : {
            circleId,
            status: {
              in: ["pending_target_acceptance", "pending_governance", "executed"],
            },
            OR: [
              { fromOwnerUserId: actorUserId },
              { targetUserId: actorUserId },
              { requestedByUserId: actorUserId },
            ],
          };
      const requests = await (prisma as any).circleOwnerTransferRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 25,
      });
      res.json({
        circleId,
        requests: requests.map(publicCircleOwnerTransferRequest),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      res.status(400).json({
        error: error instanceof Error ? error.message : "owner_transfer_requests_lookup_failed",
      });
    }
  });

  router.post("/:circleId/authority/owner-transfer", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      const targetUserId = asPositiveInteger(req.body?.targetUserId);
      if (!circleId || !targetUserId) {
        res.status(400).json({ error: "invalid_owner_transfer_input" });
        return;
      }
      const actor = await requireCircleOwnerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const actorUserId = actor.userId;
      if (actorUserId === targetUserId) {
        res.status(400).json({ error: "owner_transfer_self_target_not_supported" });
        return;
      }

      const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: { id: true, creatorId: true, lifecycleStatus: true },
      });
      if (!circle) {
        res.status(404).json({ error: "circle_not_found" });
        return;
      }
      if (String(circle.lifecycleStatus) === "Archived") {
        res.status(409).json({ error: "owner_transfer_circle_archived" });
        return;
      }
      if (String(circle.lifecycleStatus) !== "Active") {
        res.status(409).json({ error: "owner_transfer_circle_inactive" });
        return;
      }
      if (Number(circle.creatorId) !== actorUserId) {
        res.status(409).json({ error: "owner_transfer_requires_current_creator" });
        return;
      }

      const targetMembership = await prisma.circleMember.findUnique({
        where: {
          circleId_userId: {
            circleId,
            userId: targetUserId,
          },
        },
        select: { id: true, role: true, status: true },
      });
      if (!targetMembership || String(targetMembership.status) !== MemberStatus.Active) {
        res.status(404).json({ error: "owner_transfer_target_active_member_required" });
        return;
      }
      if (String(targetMembership.role) === MemberRole.Owner) {
        res.status(409).json({ error: "owner_transfer_target_already_owner" });
        return;
      }

      const existing = await (prisma as any).circleOwnerTransferRequest.findFirst({
        where: {
          circleId,
          fromOwnerUserId: actorUserId,
          targetUserId,
          status: { in: ["pending_target_acceptance", "pending_governance"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        res.json({
          status: existing.status,
          transfer: publicCircleOwnerTransferRequest(existing),
        });
        return;
      }

      const transfer = await (prisma as any).circleOwnerTransferRequest.create({
        data: {
          id: randomUUID(),
          circleId,
          fromOwnerUserId: actorUserId,
          targetUserId,
          requestedByUserId: actorUserId,
          status: "pending_target_acceptance",
          reason: asOptionalString(req.body?.reason),
          executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
          chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
        },
      });
      res.status(201).json({
        status: "pending_target_acceptance",
        transfer: publicCircleOwnerTransferRequest(transfer),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      res.status(400).json({
        error: error instanceof Error ? error.message : "owner_transfer_create_failed",
      });
    }
  });

  router.post("/:circleId/authority/owner-transfer-requests/:transferId/accept", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      const transferId = String(req.params.transferId || "").trim();
      if (!circleId || !transferId) {
        res.status(400).json({ error: "invalid_owner_transfer_accept_input" });
        return;
      }
      const actor = await requireAuthenticatedActor(req, prisma as any, {
        requireSessionCookie: true,
      });
      await requireCircleActorForAuthActor(actor, prisma as any, {
        circleId,
        action: "circle.read",
        requireMemberChainPresence: false,
      });
      const actorUserId = actor.userId;

      const transfer = await (prisma as any).circleOwnerTransferRequest.findUnique({
        where: { id: transferId },
      });
      if (!transfer || Number(transfer.circleId) !== circleId) {
        res.status(404).json({ error: "owner_transfer_not_found" });
        return;
      }
      if (Number(transfer.targetUserId) !== actorUserId) {
        res.status(403).json({ error: "owner_transfer_target_acceptance_required" });
        return;
      }
      if (String(transfer.status) === "executed") {
        res.json({
          status: "executed",
          transfer: publicCircleOwnerTransferRequest(transfer),
        });
        return;
      }
      if (
        String(transfer.status) !== "pending_target_acceptance" &&
        String(transfer.status) !== "pending_governance"
      ) {
        res.status(409).json({ error: "owner_transfer_not_accepting" });
        return;
      }
      if (String(transfer.status) === "pending_governance" && transfer.governanceRequestId) {
        const existingRequest = await (prisma as any).governanceRequest.findUnique({
          where: { id: String(transfer.governanceRequestId) },
          include: { snapshot: true },
        });
        if (existingRequest && existingRequest.state === "active") {
          res.status(202).json({
            status: "requires_governance",
            request: publicRequest(existingRequest),
            transfer: publicCircleOwnerTransferRequest(transfer),
          });
          return;
        }
      }

      const ownerCapability = await resolveOwnerTransferSourceOwnerCapability(prisma, {
        circleId,
        ownerUserId: Number(transfer.fromOwnerUserId),
      });
      if (!ownerCapability.ok) {
        res.status(409).json({ error: ownerCapability.error });
        return;
      }

      const registry = createGovernedActionRegistry({
        includePhase1Defaults: true,
        includeCircleLifecycleActions: true,
        includeCircleAuthorityActions: true,
      });
      const gateway = new GovernedActionGateway({
        registry,
        resolveBinding: (input) =>
          resolveActiveCircleGovernanceBinding(prisma as any, input),
        listCommitteeEligibleActors: (input) =>
          listCommitteeEligibleActors(prisma as any, input),
        requestStore: createPrismaGovernanceRequestStore(prisma as any),
        runtimePrisma: prisma as any,
      });
      const decision = await gateway.evaluate({
        actionType: CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
        targetCircleId: circleId,
        actorPubkey: ownerCapability.pubkey,
        directAllowed: ownerCapability.directAllowed,
      });
      const acceptedAt = transfer.targetAcceptedAt ?? new Date();

      if (decision.status === "requires_governance") {
        const idempotencyKey = `circle-owner-transfer:${transfer.id}`;
        const existingRequest = await (prisma as any).governanceRequest.findFirst({
          where: {
            scopeType: "circle_governance_committee",
            scopeRef: String(decision.committeeCircleId),
            actionType: CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
            targetType: "circle",
            targetRef: String(circleId),
            idempotencyKey,
            state: "active",
          },
          include: { snapshot: true },
          orderBy: { openedAt: "desc" },
        });
        if (existingRequest) {
          const updatedTransfer = await (prisma as any).circleOwnerTransferRequest.update({
            where: { id: transfer.id },
            data: {
              status: "pending_governance",
              targetAcceptedAt: acceptedAt,
              governanceRequestId: existingRequest.id,
              executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
              chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
            },
          });
          res.status(202).json({
            status: "requires_governance",
            request: publicRequest(existingRequest),
            transfer: publicCircleOwnerTransferRequest(updatedTransfer),
          });
          return;
        }
        const request = await gateway.openRequest({
          actionType: CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
          targetCircleId: circleId,
          targetType: "circle",
          targetRef: String(circleId),
          payload: {
            transferRequestId: transfer.id,
            fromOwnerUserId: Number(transfer.fromOwnerUserId),
            targetUserId: Number(transfer.targetUserId),
            targetAcceptedAt: acceptedAt instanceof Date ? acceptedAt.toISOString() : String(acceptedAt),
            reason: transfer.reason ?? null,
            executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
            chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
          },
          idempotencyKey,
          proposerPubkey: ownerCapability.pubkey,
        });
        const updatedTransfer = await (prisma as any).circleOwnerTransferRequest.update({
          where: { id: transfer.id },
          data: {
            status: "pending_governance",
            targetAcceptedAt: acceptedAt,
            governanceRequestId: request.id,
            executionMode: CIRCLE_OWNER_TRANSFER_EXECUTION_MODE,
            chainStatus: CIRCLE_OWNER_TRANSFER_CHAIN_STATUS,
          },
        });
        res.status(202).json({
          status: "requires_governance",
          request: publicRequest(request),
          transfer: publicCircleOwnerTransferRequest(updatedTransfer),
        });
        return;
      }

      if (decision.status === "denied") {
        res.status(403).json({ error: decision.reason });
        return;
      }

      const executed = await executeCircleOwnerTransfer(prisma as any, redis as any, {
        transferRequestId: transfer.id,
        acceptedAt,
      });
      res.json({
        status: "executed",
        transfer: executed.transfer,
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      res.status(400).json({
        error: error instanceof Error ? error.message : "owner_transfer_accept_failed",
      });
    }
  });

  return router;
}
