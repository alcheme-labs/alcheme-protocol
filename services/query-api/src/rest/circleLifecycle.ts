import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import {
  CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
  CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
  createGovernedActionRegistry,
} from "../services/governance/actionRegistry";
import { GovernedActionGateway } from "../services/governance/governedActionGateway";
import {
  circleLifecycleActionType,
  normalizeCircleLifecycleAction,
} from "../services/governance/circleLifecycle";
import {
  createCircleLifecycleChainReader,
  reconcileCircleLifecycleFromChain,
  type CircleLifecycleChainReader,
} from "../services/governance/governanceCircleLifecycleRuntime";
import {
  prepareGovernanceHomeLifecyclePlan,
  convergeGovernanceHomeLifecycleAuthoritativeReadback,
  exportLatestGovernanceHomeLifecycleTimeline,
  publicGovernanceHomeLifecyclePlan,
  readLatestGovernanceHomeLifecyclePlan,
  recordGovernanceHomeLifecycleBlocked,
  recordGovernanceHomeLifecycleReconciliationPending,
} from "../services/governance/governanceHomeLifecyclePlan";
import { loadGovernanceProviderIndexerObservations } from "../services/governance/governanceProviderProjectionContext";
import {
  createGovernanceLegacyMigrationSurface,
  type GovernanceLegacyMigrationSurface,
} from "../services/governance/governanceLegacyMigrationSurface";
import {
  GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID,
} from "../services/governance/governanceBootstrapCeremonyContract";
import { publishCircleLifecycleSystemNotice } from "../services/discussion/systemNoticeProducer";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "../services/governance/circleGovernanceBindings";
import { createPrismaGovernanceRequestStore } from "../services/governance/policyEngine";
import { requireCircleManagerActor } from "../services/auth/actor";
import { sendAuthActorError } from "../services/auth/actorPermissions";
import { hashCanonicalGovernanceValue } from '../services/governance/canonicalCodec';
import {
  finalizeGovernanceHomeMergePlan,
  normalizeCircleMergeDisposition,
  prepareGovernanceHomeMergePlan,
  recordCircleMergeSourceApproval,
  validateCircleMergeSourceApprovalRefs,
} from '../services/governance/governanceHomeMerge';

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function publicCircleLifecycle(circle: {
  id: number;
  lifecycleStatus: string;
  archivedAt?: Date | string | null;
  archivedByPubkey?: string | null;
  archiveReason?: string | null;
}) {
  return {
    id: circle.id,
    lifecycleStatus: circle.lifecycleStatus,
    archivedAt: circle.archivedAt instanceof Date
      ? circle.archivedAt.toISOString()
      : circle.archivedAt ?? null,
    archivedByPubkey: circle.archivedByPubkey ?? null,
    archiveReason: circle.archiveReason ?? null,
  };
}

function lifecycleStatusAfterAction(action: ReturnType<typeof normalizeCircleLifecycleAction>): "Active" | "Archived" | null {
  if (!action) return null;
  if (action === "restore") return "Active";
  if (action === "archive") return "Archived";
  return null;
}

function pendingLifecycleActionTypes(action: ReturnType<typeof normalizeCircleLifecycleAction>): string[] {
  if (action === "restore") return ["circle.lifecycle.restore"];
  if (action === "dissolve") return ["circle.lifecycle.dissolve"];
  return ["circle.lifecycle.archive"];
}

function futureIsoOrNull(value: unknown, now = new Date()): string | null {
  const normalized = asOptionalString(value);
  if (!normalized) return null;
  const parsed = normalized ? new Date(normalized) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    throw new Error('circle_dissolution_future_exit_window_required');
  }
  return parsed.toISOString();
}

function lifecycleIdempotencyKey(input: {
  actionType: string;
  circleId: number;
  lifecycleStatus: unknown;
  updatedAt?: Date | string | null;
}): string {
  const updatedAt = input.updatedAt instanceof Date
    ? input.updatedAt.getTime()
    : String(input.updatedAt ?? "unknown");
  return `circle-lifecycle:${input.actionType}:${input.circleId}:${String(input.lifecycleStatus)}:${updatedAt}`;
}

async function findActiveLifecycleGovernanceRequest(
  prisma: any,
  input: {
    actionTypes: string[];
    circleId: number;
    committeeCircleId?: number | null;
  },
) {
  if (
    !input.committeeCircleId ||
    typeof prisma?.governanceRequest?.findFirst !== "function"
  ) {
    return null;
  }
  return prisma.governanceRequest.findFirst({
    where: {
      scopeType: "circle_governance_committee",
      scopeRef: String(input.committeeCircleId),
      actionType: input.actionTypes.length === 1
        ? input.actionTypes[0]
        : { in: input.actionTypes },
      targetType: "circle",
      targetRef: String(input.circleId),
      state: "active",
    },
    include: { snapshot: true },
    orderBy: { openedAt: "desc" },
  });
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

export function circleLifecycleRouter(
  prisma: PrismaClient,
  redis: Redis,
  dependencies: {
    chainReader?: CircleLifecycleChainReader;
    migrationSurface?: GovernanceLegacyMigrationSurface;
  } = {},
): Router {
  const router = Router();

  let resolvedMigrationSurface = dependencies.migrationSurface;
  const migrationSurface = () => {
    resolvedMigrationSurface ??= productionLegacyMigrationSurface(prisma);
    return resolvedMigrationSurface;
  };

  router.post("/:circleId/governance-migration/compatibility", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const report = await migrationSurface().prepare({ circleId, actorPubkey: actor.pubkey });
      res.json({ ok: true, report });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      sendMigrationError(res, error);
    }
  });

  router.post("/:circleId/governance-migration/finalize", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      const compatibilityBundleId = asOptionalString(req.body?.compatibilityBundleId);
      const transactionSignature = asOptionalString(req.body?.transactionSignature);
      if (!circleId || !compatibilityBundleId || !transactionSignature) {
        return res.status(400).json({ error: "invalid_governance_migration_finalization" });
      }
      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const report = await migrationSurface().finalize({
        circleId,
        actorPubkey: actor.pubkey,
        compatibilityBundleId,
        transactionSignature,
      });
      res.json({ ok: true, report });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      sendMigrationError(res, error);
    }
  });

  router.get("/:circleId/governance-migration/export", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const report = await migrationSurface().read({
        circleId,
        actorPubkey: actor.pubkey,
      });
      if ((report as any)?.circleId !== circleId) {
        throw new Error("governance_migration_export_circle_mismatch");
      }
      const digestBody = {
        schemaVersion: 1 as const,
        audience: "circle_manager" as const,
        circleId,
        exportedAt: new Date().toISOString(),
        digestDomain: "alcheme.governance.legacy-migration-audit-export" as const,
        digestAlgorithm: "sha256" as const,
        report,
      };
      res.json({
        export: {
          ...digestBody,
          exportDigest: hashCanonicalGovernanceValue(
            "alcheme.governance.legacy-migration-audit-export",
            digestBody,
          ),
        },
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      sendMigrationError(res, error);
    }
  });

  router.get("/:circleId/governance-migration", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const report = await migrationSurface().read({ circleId, actorPubkey: actor.pubkey });
      res.json({ ok: true, report });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      sendMigrationError(res, error);
    }
  });

  router.get("/:circleId/lifecycle", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: {
          id: true,
          lifecycleStatus: true,
          archivedAt: true,
          archivedByPubkey: true,
          archiveReason: true,
        },
      });
      if (!circle) return res.status(404).json({ error: "circle_not_found" });
      const plan = await readLatestGovernanceHomeLifecyclePlan(prisma as any, circleId);
      res.json({
        circle: publicCircleLifecycle(circle),
        plan: publicGovernanceHomeLifecyclePlan(plan),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      res.status(400).json({
        error: error instanceof Error ? error.message : "circle_lifecycle_read_failed",
      });
    }
  });

  router.get('/:circleId/lifecycle/export', async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
      await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });
      const timeline = await exportLatestGovernanceHomeLifecycleTimeline(prisma as any, { circleId });
      res.json({ timeline });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      res.status(400).json({
        error: error instanceof Error ? error.message : 'circle_lifecycle_export_failed',
      });
    }
  });

  router.post('/:circleId/lifecycle/merge/source-approval', async (req, res) => {
    try {
      const sourceCircleId = asPositiveInteger(req.params.circleId);
      if (!sourceCircleId) return res.status(400).json({ error: 'invalid_circle_id' });
      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId: sourceCircleId,
        requireSessionCookie: true,
      });
      const suppliedRequestId = asOptionalString(req.body?.governanceRequestId);
      if (suppliedRequestId) {
        const finalization = await readLifecycleGovernanceFinalization(prisma as any, {
          requestId: suppliedRequestId,
          actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
          circleId: sourceCircleId,
          errorCodes: [
            'merge_source_approval_recording_required',
            'merge_source_approved',
          ],
        });
        if (finalization.request.state === 'active') {
          return res.status(202).json({
            status: 'requires_governance',
            actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
            request: publicRequest(finalization.request),
          });
        }
        const approval = await recordCircleMergeSourceApproval(prisma as any, {
          requestId: suppliedRequestId,
          sourceCircleId,
          actorPubkey: actor.pubkey,
        });
        return res.json({
          status: 'source_approved',
          actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
          approval,
        });
      }

      const mergeDisposition = normalizeCircleMergeDisposition(req.body?.mergeDisposition);
      const successorCircleId = Number(mergeDisposition.successorCircleId);
      if (successorCircleId === sourceCircleId) {
        throw new Error('circle_merge_successor_must_differ');
      }
      const registry = createGovernedActionRegistry({
        includePhase1Defaults: true,
        includeCircleLifecycleActions: true,
      });
      const gateway = lifecycleGateway(prisma, registry);
      const decision = await gateway.evaluate({
        actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
        targetCircleId: sourceCircleId,
        actorPubkey: actor.pubkey,
        directAllowed: false,
      });
      if (decision.status === 'denied') {
        return res.status(403).json({ error: decision.reason });
      }
      if (decision.status !== 'requires_governance') {
        throw new Error('circle_merge_source_governance_required');
      }
      const existingRequest = await findActiveLifecycleGovernanceRequest(prisma as any, {
        actionTypes: [CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE],
        circleId: sourceCircleId,
        committeeCircleId: decision.committeeCircleId,
      });
      if (existingRequest) {
        return res.status(202).json({
          status: 'requires_governance',
          actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
          request: publicRequest(existingRequest),
        });
      }
      const dispositionDigest = hashCanonicalGovernanceValue(
        'alcheme.governance.home-merge-source-disposition',
        mergeDisposition,
      );
      const request = await gateway.openRequest({
        actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
        targetCircleId: sourceCircleId,
        targetType: 'circle',
        targetRef: String(sourceCircleId),
        payload: {
          requestedLifecycleAction: 'merge_source_approve',
          actorPubkey: actor.pubkey,
          mergeDisposition,
          dispositionDigest,
        },
        idempotencyKey: `circle-merge-source:${sourceCircleId}:${successorCircleId}:${dispositionDigest.slice(0, 32)}`,
        proposerPubkey: actor.pubkey,
      });
      return res.status(202).json({
        status: 'requires_governance',
        actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
        request: publicRequest(request),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'circle_merge_source_approval_failed',
      });
    }
  });

  router.post('/:circleId/lifecycle/merge/accept', async (req, res) => {
    try {
      const successorCircleId = asPositiveInteger(req.params.circleId);
      if (!successorCircleId) return res.status(400).json({ error: 'invalid_circle_id' });
      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId: successorCircleId,
        requireSessionCookie: true,
      });
      const suppliedRequestId = asOptionalString(req.body?.governanceRequestId);
      if (suppliedRequestId) {
        const finalization = await readLifecycleGovernanceFinalization(prisma as any, {
          requestId: suppliedRequestId,
          actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
          circleId: successorCircleId,
          errorCodes: ['merge_successor_acceptance_pending', 'merge_pending', 'merge_completed'],
        });
        if (finalization.request.state === 'active') {
          return res.status(202).json({
            status: 'requires_governance',
            actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
            request: publicRequest(finalization.request),
          });
        }
        const plan = await prepareGovernanceHomeMergePlan(prisma as any, {
          successorCircleId,
          requestId: suppliedRequestId,
          actorPubkey: actor.pubkey,
          reason: asOptionalString(finalization.request.payload?.reason),
        });
        return res.status(202).json({
          status: plan.status,
          actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
          plan: publicGovernanceHomeLifecyclePlan(plan),
        });
      }
      const sourceApprovalRequestIds = Array.isArray(req.body?.sourceApprovalRequestIds)
        ? req.body.sourceApprovalRequestIds.map(asOptionalString).filter(Boolean) as string[]
        : [];
      if (new Set(sourceApprovalRequestIds).size !== sourceApprovalRequestIds.length) {
        throw new Error('circle_merge_source_approval_duplicate');
      }
      const approvals = await validateCircleMergeSourceApprovalRefs(prisma as any, {
        successorCircleId,
        sourceApprovalRequestIds,
      });
      const registry = createGovernedActionRegistry({
        includePhase1Defaults: true,
        includeCircleLifecycleActions: true,
      });
      const gateway = lifecycleGateway(prisma, registry);
      const decision = await gateway.evaluate({
        actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
        targetCircleId: successorCircleId,
        actorPubkey: actor.pubkey,
        directAllowed: false,
      });
      if (decision.status === 'denied') {
        return res.status(403).json({ error: decision.reason });
      }
      if (decision.status !== 'requires_governance') {
        throw new Error('circle_merge_successor_governance_required');
      }
      const approvalSet = approvals
        .map((approval) => ({
          sourceCircleId: approval.sourceCircleId,
          requestId: approval.sourceApprovalRequestId,
          approvalDigest: approval.approvalDigest,
        }))
        .sort((left, right) => left.sourceCircleId - right.sourceCircleId);
      const approvalSetDigest = hashCanonicalGovernanceValue(
        'alcheme.governance.home-merge-approval-set',
        approvalSet,
      );
      const request = await gateway.openRequest({
        actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
        targetCircleId: successorCircleId,
        targetType: 'circle',
        targetRef: String(successorCircleId),
        payload: {
          requestedLifecycleAction: 'merge_successor_accept',
          actorPubkey: actor.pubkey,
          reason: asOptionalString(req.body?.reason),
          sourceApprovalRequestIds: approvalSet.map((item) => item.requestId),
          sourceApprovalSet: approvalSet,
          approvalSetDigest,
        },
        idempotencyKey: `circle-merge-successor:${successorCircleId}:${approvalSetDigest.slice(0, 48)}`,
        proposerPubkey: actor.pubkey,
      });
      return res.status(202).json({
        status: 'requires_governance',
        actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
        request: publicRequest(request),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'circle_merge_successor_acceptance_failed',
      });
    }
  });

  router.post('/:circleId/lifecycle/merge/finalize', async (req, res) => {
    try {
      const successorCircleId = asPositiveInteger(req.params.circleId);
      const requestId = asOptionalString(req.body?.governanceRequestId);
      if (!successorCircleId || !requestId) {
        return res.status(400).json({ error: 'circle_merge_finalization_input_invalid' });
      }
      await requireCircleManagerActor(req, prisma as any, {
        circleId: successorCircleId,
        requireSessionCookie: true,
      });
      const plan = await finalizeGovernanceHomeMergePlan(prisma as any, {
        successorCircleId,
        requestId,
      });
      return res.json({
        status: plan.status,
        actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
        plan: publicGovernanceHomeLifecyclePlan(plan),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'circle_merge_finalization_failed',
      });
    }
  });

  router.post("/:circleId/lifecycle/:action", async (req, res) => {
    try {
      const circleId = asPositiveInteger(req.params.circleId);
      const action = normalizeCircleLifecycleAction(req.params.action);
      if (!circleId || !action) {
        res.status(400).json({ error: "invalid_circle_lifecycle_input" });
        return;
      }

      const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId,
        requireSessionCookie: true,
      });

      const actionType = circleLifecycleActionType(action);
      const dissolutionExitWindowEndsAt = action === 'dissolve'
        ? futureIsoOrNull(req.body?.exitWindowEndsAt)
        : null;
      const retentionSuccessorHomeIdentityBindingId = action === 'dissolve'
        ? asOptionalString(req.body?.retentionSuccessorHomeIdentityBindingId)
        : null;
      const lifecycleCircle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: {
          id: true,
          lifecycleStatus: true,
          archivedAt: true,
          archivedByPubkey: true,
          archiveReason: true,
          updatedAt: true,
        },
      });
      if (!lifecycleCircle) {
        res.status(404).json({ error: "circle_not_found" });
        return;
      }
      const suppliedTransactionSignature = asOptionalString(req.body?.transactionSignature);
      const suppliedGovernanceRequestId = asOptionalString(req.body?.governanceRequestId);
      const latestLifecyclePlan = await readLatestGovernanceHomeLifecyclePlan(
        prisma as any,
        circleId,
      );
      if (
        latestLifecyclePlan
        && latestLifecyclePlan.governingRequestId !== suppliedGovernanceRequestId
      ) {
        throw new Error('circle_lifecycle_reconciliation_in_progress');
      }
      if (
        latestLifecyclePlan?.governingRequestId === suppliedGovernanceRequestId
        && latestLifecyclePlan.status !== 'awaiting_wallet'
        && latestLifecyclePlan.status !== 'reconciliation_pending'
      ) {
        res.json({
          status: latestLifecyclePlan.status,
          actionType,
          circle: publicCircleLifecycle(lifecycleCircle),
          governanceRequestId: suppliedGovernanceRequestId,
          plan: publicGovernanceHomeLifecyclePlan(latestLifecyclePlan),
        });
        return;
      }
      const governanceRequestId = suppliedGovernanceRequestId;
      const governanceFinalization = governanceRequestId
        ? await readLifecycleGovernanceFinalization(prisma as any, {
            requestId: governanceRequestId,
            actionType,
            circleId,
          })
        : null;
      if (governanceFinalization?.request.state === 'active') {
        res.status(202).json({
          status: 'requires_governance',
          actionType,
          request: publicRequest(governanceFinalization.request),
        });
        return;
      }

      if (!governanceFinalization) {
        const registry = createGovernedActionRegistry({
          includePhase1Defaults: true,
          includeCircleLifecycleActions: true,
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
          actionType,
          targetCircleId: circleId,
          actorPubkey: actor.pubkey,
          directAllowed: true,
        });

        if (decision.status === "requires_governance") {
          const existingRequest = await findActiveLifecycleGovernanceRequest(prisma as any, {
            actionTypes: pendingLifecycleActionTypes(action),
            circleId,
            committeeCircleId: decision.committeeCircleId,
          });
          if (existingRequest) {
            res.status(202).json({
              status: "requires_governance",
              actionType: existingRequest.actionType ?? actionType,
              request: publicRequest(existingRequest),
            });
            return;
          }
          if (action === 'dissolve' && !dissolutionExitWindowEndsAt) {
            throw new Error('circle_dissolution_future_exit_window_required');
          }
          const request = await gateway.openRequest({
            actionType,
            targetCircleId: circleId,
            targetType: "circle",
            targetRef: String(circleId),
            payload: {
              reason: asOptionalString(req.body?.reason),
              actorPubkey: actor.pubkey,
              requestedLifecycleAction: action,
              ...(action === 'dissolve'
                ? {
                    exitWindowEndsAt: dissolutionExitWindowEndsAt,
                    retentionSuccessorHomeIdentityBindingId,
                    irreversibleCutover: 'not_started',
                  }
                : {}),
            },
            idempotencyKey: lifecycleIdempotencyKey({
              actionType,
              circleId,
              lifecycleStatus: lifecycleCircle.lifecycleStatus,
              updatedAt: lifecycleCircle.updatedAt,
            }),
            proposerPubkey: actor.pubkey,
          });
          res.status(202).json({
            status: "requires_governance",
            actionType,
            request: publicRequest(request),
          });
          return;
        }

        if (decision.status === "denied") {
          res.status(403).json({
            error: decision.reason,
          });
          return;
        }
      }

      if (!governanceFinalization?.receipt) {
        throw new Error('circle_lifecycle_governance_finalization_required');
      }
      const decisionDigest = asOptionalString(governanceFinalization.receipt.decisionDigest);
      if (!decisionDigest) {
        throw new Error('circle_lifecycle_governing_decision_digest_required');
      }
      const acceptedPayload = governanceFinalization.request.payload
        && typeof governanceFinalization.request.payload === 'object'
        && !Array.isArray(governanceFinalization.request.payload)
        ? governanceFinalization.request.payload as Record<string, unknown>
        : {};
      const lifecyclePlan = await prepareGovernanceHomeLifecyclePlan(prisma as any, {
        circleId,
        action,
        currentLifecycleStatus: String(lifecycleCircle.lifecycleStatus),
        actorPubkey: actor.pubkey,
        reason: action === 'dissolve'
          ? asOptionalString(acceptedPayload.reason)
          : asOptionalString(req.body?.reason),
        governingRequestId: governanceFinalization.request.id,
        governingDecisionDigest: decisionDigest,
        governanceExecutionReceipt: governanceFinalization.receipt,
        requestHomeIdentityBindingId:
          asOptionalString(governanceFinalization.request.homeIdentityBindingId),
        allowAlreadyProjectedWithChainEvidence: Boolean(suppliedTransactionSignature),
        dissolutionExitWindowEndsAt: action === 'dissolve'
          ? asOptionalString(acceptedPayload.exitWindowEndsAt)
          : null,
        retentionSuccessorHomeIdentityBindingId: action === 'dissolve'
          ? asOptionalString(acceptedPayload.retentionSuccessorHomeIdentityBindingId)
          : null,
      });
      if (action === 'dissolve') {
        const projectedCircle = await prisma.circle.findUnique({
          where: { id: circleId },
          select: {
            id: true,
            lifecycleStatus: true,
            archivedAt: true,
            archivedByPubkey: true,
            archiveReason: true,
          },
        });
        if (!projectedCircle || projectedCircle.lifecycleStatus !== 'DissolutionPending') {
          throw new Error('circle_dissolution_projection_readback_mismatch');
        }
        res.status(202).json({
          status: 'dissolution_pending',
          actionType,
          circle: publicCircleLifecycle(projectedCircle),
          governanceRequestId: governanceFinalization.request.id,
          plan: publicGovernanceHomeLifecyclePlan(lifecyclePlan),
        });
        return;
      }
      const chainAction = action === "restore" ? "restore" : "archive";
      const pendingSignature = asOptionalString(
        (lifecyclePlan.reconciliation as any)?.chain?.transactionSignature,
      );
      const transactionSignature = suppliedTransactionSignature || pendingSignature;
      if (!transactionSignature) {
        res.json({
          status: "requires_wallet_transaction",
          actionType,
          chainAction,
          governanceRequestId: governanceFinalization.request.id,
          plan: publicGovernanceHomeLifecyclePlan(lifecyclePlan),
        });
        return;
      }
      const chainReader = dependencies.chainReader ?? productionLifecycleChainReader();
      if (lifecyclePlan.status === 'converged') {
        const circle = await prisma.circle.findUnique({ where: { id: circleId } });
        if (!circle) throw new Error('circle_not_found');
        res.json({
          status: 'converged',
          actionType,
          circle: publicCircleLifecycle(circle),
          transactionSignature,
          governanceRequestId: governanceFinalization.request.id,
          plan: publicGovernanceHomeLifecyclePlan(lifecyclePlan),
        });
        return;
      }
      if (lifecyclePlan.status === 'reconciliation_pending') {
        const circleAccountRef = String(
          (await prisma.circle.findUnique({
            where: { id: circleId },
            select: { onChainAddress: true },
          }))?.onChainAddress || '',
        );
        if (!circleAccountRef) throw new Error('circle_lifecycle_chain_account_missing');
        let finalizedEvidence;
        try {
          finalizedEvidence = await chainReader.verifyAndRead({
            network: 'solana:localnet',
            transactionSignature,
            circleId,
            circleAccountRef,
            actorPubkey: actor.pubkey,
            action: chainAction,
            commitment: 'finalized',
          });
        } catch (error) {
          if (
            error instanceof Error
            && error.message === 'circle_lifecycle_transaction_not_finalized'
          ) {
            const pendingCircle = await prisma.circle.findUnique({ where: { id: circleId } });
            if (!pendingCircle) throw new Error('circle_not_found');
            res.json({
              status: 'reconciliation_pending',
              actionType,
              circle: publicCircleLifecycle(pendingCircle),
              transactionSignature,
              governanceRequestId: governanceFinalization.request.id,
              plan: publicGovernanceHomeLifecyclePlan(lifecyclePlan),
            });
            return;
          }
          throw error;
        }
        const programId = String(
          process.env.CIRCLES_PROGRAM_ID || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID || '',
        ).trim();
        if (!programId || programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
          throw new Error('circle_lifecycle_indexer_program_mismatch');
        }
        const observations = await loadGovernanceProviderIndexerObservations(
          prisma as any,
          [programId],
        );
        const observation = observations.get(programId);
        if (!observation || observation.loadState === 'unavailable') {
          throw new Error('circle_lifecycle_indexer_observation_unavailable');
        }
        const circle = await prisma.circle.findUnique({ where: { id: circleId } });
        if (!circle) throw new Error('circle_not_found');
        const convergedPlan = await convergeGovernanceHomeLifecycleAuthoritativeReadback(
          prisma as any,
          {
            receiptId: governanceFinalization.receipt.id,
            finalizedEvidence,
            indexerReceipt: {
              programId,
              checkpointSlot: Number(observation.checkpoint?.lastProcessedSlot ?? -1),
              lastSuccessfulSync: observation.checkpoint?.lastSuccessfulSync
                ? new Date(observation.checkpoint.lastSuccessfulSync).toISOString()
                : null,
              runtimePhase: observation.runtime?.phase
                ? String(observation.runtime.phase)
                : null,
              unresolvedFailureSlot: observation.unresolvedFailure?.slot == null
                ? null
                : Number(observation.unresolvedFailure.slot),
              // Indexer authority is SyncCheckpoint/runtime only. Never reuse the
              // query-api-written Circle row as an independent indexer circle projection.
              circleProjectionSlot: null,
              circleProjectionLifecycleStatus: null,
            },
            localProjection: {
              lifecycleStatus: String(circle.lifecycleStatus),
              lastSyncedSlot: Number(circle.lastSyncedSlot ?? -1),
            },
          },
        );
        await publishLifecycleProjectionEffects(prisma, redis, {
          circleId,
          actionType,
          lifecycleStatus: String(circle.lifecycleStatus),
          actorPubkey: actor.pubkey,
          reason: asOptionalString(req.body?.reason),
        });
        res.json({
          status: convergedPlan.status === 'converged' ? 'converged' : 'reconciliation_pending',
          actionType,
          circle: publicCircleLifecycle(circle),
          transactionSignature,
          observedSlot: finalizedEvidence.observedSlot,
          governanceRequestId: governanceFinalization.request.id,
          plan: publicGovernanceHomeLifecyclePlan(convergedPlan),
        });
        return;
      }
      let projected;
      try {
        projected = await reconcileCircleLifecycleFromChain({
          prisma: prisma as any,
          chainReader,
        }, {
          network: "solana:localnet",
          circleId,
          action: chainAction,
          actorPubkey: actor.pubkey,
          reason: asOptionalString(req.body?.reason),
          transactionSignature,
        });
      } catch (error) {
        await recordGovernanceHomeLifecycleBlocked(prisma as any, {
          receiptId: governanceFinalization.receipt.id,
          blockerCode: error instanceof Error
            ? error.message
            : 'circle_lifecycle_reconciliation_failed',
        });
        throw error;
      }
      const reconciledPlan = await recordGovernanceHomeLifecycleReconciliationPending(
        prisma as any,
        {
          receiptId: governanceFinalization.receipt.id,
          evidence: projected.evidence,
          projectedLifecycleStatus: String(projected.circle.lifecycleStatus),
        },
      );
      await publishLifecycleProjectionEffects(prisma, redis, {
        circleId,
        actionType,
        lifecycleStatus: String(projected.circle.lifecycleStatus),
        actorPubkey: actor.pubkey,
        reason: asOptionalString(req.body?.reason),
      });
      res.json({
        status: "reconciliation_pending",
        actionType,
        circle: publicCircleLifecycle(projected.circle),
        activationState: projected.activation.state,
        transactionSignature,
        observedSlot: projected.evidence.observedSlot,
        governanceRequestId: governanceFinalization.request.id,
        plan: publicGovernanceHomeLifecyclePlan(reconciledPlan),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      res.status(400).json({
        error: error instanceof Error ? error.message : "circle_lifecycle_action_failed",
      });
    }
  });

  return router;
}

function productionLegacyMigrationSurface(prisma: PrismaClient): GovernanceLegacyMigrationSurface {
  if (String(process.env.GOVERNANCE_MIGRATION_RUNTIME_ENABLED || '').trim() !== 'true') {
    throw new Error('governance_migration_runtime_disabled');
  }
  if (String(process.env.GOVERNANCE_MIGRATION_CHAIN_ID || '').trim() !== 'solana:localnet') {
    throw new Error('governance_migration_runtime_network_not_enabled');
  }
  const rpcUrl = String(process.env.SOLANA_RPC_URL || process.env.RPC_URL || '').trim();
  const programId = String(
    process.env.CIRCLES_PROGRAM_ID || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID || '',
  ).trim();
  if (!rpcUrl || programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
    throw new Error('governance_migration_runtime_chain_config_mismatch');
  }
  return createGovernanceLegacyMigrationSurface({ prisma, rpcUrl, programId });
}

function lifecycleGateway(prisma: PrismaClient, registry: ReturnType<typeof createGovernedActionRegistry>) {
  return new GovernedActionGateway({
    registry,
    resolveBinding: (input) => resolveActiveCircleGovernanceBinding(prisma as any, input),
    listCommitteeEligibleActors: (input) => listCommitteeEligibleActors(prisma as any, input),
    requestStore: createPrismaGovernanceRequestStore(prisma as any),
    runtimePrisma: prisma as any,
  });
}

function sendMigrationError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : 'governance_migration_failed';
  const unavailable = message === 'governance_migration_runtime_disabled'
    || message === 'governance_migration_runtime_network_not_enabled'
    || message === 'governance_migration_runtime_chain_config_mismatch';
  res.status(unavailable ? 503 : 409).json({ error: message });
}

async function readLifecycleGovernanceFinalization(
  prisma: any,
  input: {
    requestId: string;
    actionType: string;
    circleId: number;
    errorCodes?: string[];
  },
): Promise<{ request: any; receipt: any | null }> {
  const request = await prisma.governanceRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new Error('circle_lifecycle_governance_request_missing');
  if (
    request.actionType !== input.actionType
    || request.targetType !== 'circle'
    || request.targetRef !== String(input.circleId)
  ) {
    throw new Error('circle_lifecycle_governance_request_target_mismatch');
  }
  if (request.state === 'active') return { request, receipt: null };
  if (request.state !== 'accepted') {
    throw new Error('circle_lifecycle_governance_decision_not_accepted');
  }
  const receipt = await prisma.governanceExecutionReceipt.findFirst({
    where: {
      requestId: request.id,
      executorModule: 'circle_lifecycle',
      executionStatus: { in: ['skipped', 'executed'] },
      errorCode: {
        in: input.errorCodes ?? [
          'wallet_finalization_required',
          'external_reconciliation_pending',
          'lifecycle_authoritative_convergence_complete',
          'dissolution_disposition_pending',
        ],
      },
    },
    orderBy: { executedAt: 'desc' },
  });
  if (!receipt) throw new Error('circle_lifecycle_wallet_finalization_receipt_missing');
  return { request, receipt };
}

function productionLifecycleChainReader(): CircleLifecycleChainReader {
  if (String(process.env.GOVERNANCE_SIGNAL_CHAIN_ID || '').trim() !== 'solana:localnet') {
    throw new Error('circle_lifecycle_network_not_enabled');
  }
  const rpcUrl = String(process.env.SOLANA_RPC_URL || process.env.RPC_URL || '').trim();
  const programId = String(
    process.env.CIRCLES_PROGRAM_ID || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID || '',
  ).trim();
  if (!rpcUrl || !programId) throw new Error('circle_lifecycle_chain_unavailable');
  return createCircleLifecycleChainReader({ rpcUrl, programId });
}

async function publishLifecycleProjectionEffects(
  prisma: PrismaClient,
  redis: Redis,
  input: {
    circleId: number;
    actionType: string;
    lifecycleStatus: string;
    actorPubkey: string;
    reason: string | null;
  },
): Promise<void> {
  const cacheKey = `circle:${input.circleId}`;
  await redis?.del?.(cacheKey);
  await redis?.publish?.(
    'cache:invalidation',
    JSON.stringify({ type: 'invalidation', key: cacheKey }),
  );
  if (
    typeof (prisma as any)?.$queryRaw !== 'function'
    || typeof (prisma as any)?.$transaction !== 'function'
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
