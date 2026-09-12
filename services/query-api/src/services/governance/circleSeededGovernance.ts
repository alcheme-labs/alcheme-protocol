import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { createGovernedActionRegistry } from "./actionRegistry";
import { GovernedActionGateway } from "./governedActionGateway";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "./circleGovernanceBindings";
import { createPrismaGovernanceRequestStore } from "./policyEngine";
import {
  buildSeededImportPlan,
  importSeededSources,
  type SeededImportFileInput,
} from "../seeded/importer";
import {
  buildPrivateTextLocator,
  loadPrivateText,
  storePrivateText,
} from "../privateContentBridge";
import { markCircleTopicProfileDirty } from "../discussion/analysis/invalidation";

export const CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE = "circle.seeded.replace_manifest";

interface StagedSeededFile {
  path: string;
  nodeType: "directory" | "file";
  parentPath: string | null;
  name: string;
  depth: number;
  sortOrder: number;
  mimeType: string | null;
  contentHash: string | null;
  byteSize: number;
  lineCount: number | null;
  contentLocator: string | null;
}

export function publicCircleSeededGovernanceRequest(request: any) {
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

export async function stageCircleSeededReplaceManifestPayload(input: {
  circleId: number;
  files: SeededImportFileInput[];
}): Promise<Record<string, unknown>> {
  const plan = buildSeededImportPlan(input.files);
  const stagingId = randomUUID();
  const locatorsByPath = new Map<string, string>();

  await Promise.all(plan.nodes.map(async (node) => {
    if (node.nodeType !== "file") return;
    const locator = buildPrivateTextLocator(
      "governance-seeded-pending",
      String(input.circleId),
      stagingId,
      node.path,
    );
    await storePrivateText({
      locator,
      content: node.contentText ?? "",
    });
    locatorsByPath.set(node.path, locator);
  }));

  const stagedFiles: StagedSeededFile[] = plan.nodes.map((node) => ({
    path: node.path,
    nodeType: node.nodeType,
    parentPath: node.parentPath,
    name: node.name,
    depth: node.depth,
    sortOrder: node.sortOrder,
    mimeType: node.mimeType,
    contentHash: node.contentHash,
    byteSize: node.byteSize,
    lineCount: node.lineCount,
    contentLocator: node.nodeType === "file" ? locatorsByPath.get(node.path) ?? null : null,
  }));

  return {
    operation: "replace_manifest",
    manifestDigest: plan.manifestDigest,
    fileCount: plan.fileCount,
    nodeCount: plan.nodes.length,
    stagingId,
    stagedAt: new Date().toISOString(),
    stagedFiles,
  };
}

export function buildCircleSeededReplaceManifestDigest(files: SeededImportFileInput[]): string {
  return buildSeededImportPlan(files).manifestDigest;
}

export async function evaluateCircleSeededGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    directAllowed: boolean;
    manifestDigest: string;
    buildPayload: () => Promise<Record<string, unknown>>;
  },
): Promise<
  | { status: "direct_allowed" }
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicCircleSeededGovernanceRequest> }
> {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeCircleSeededActions: true,
  });
  const gateway = new GovernedActionGateway({
    registry,
    resolveBinding: (bindingInput) =>
      resolveActiveCircleGovernanceBinding(prisma as any, bindingInput),
    listCommitteeEligibleActors: (eligibleInput) =>
      listCommitteeEligibleActors(prisma as any, eligibleInput),
    requestStore: createPrismaGovernanceRequestStore(prisma as any),
    runtimePrisma: prisma as any,
  });

  const decision = await gateway.evaluate({
    actionType: CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
    targetCircleId: input.circleId,
    actorPubkey: input.actorPubkey,
    directAllowed: input.directAllowed,
  });

  if (decision.status === "direct_allowed") {
    return { status: "direct_allowed" };
  }
  if (decision.status === "denied") {
    return {
      status: "denied",
      error: decision.reason,
    };
  }

  const idempotencyKey = `${CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE}:${input.circleId}:${input.manifestDigest}`;
  const existingRequest = await findActiveCircleSeededRequest(prisma as any, {
    circleId: input.circleId,
    idempotencyKey,
    committeeCircleId: decision.committeeCircleId,
  });
  if (existingRequest) {
    const request = existingRequest as any;
    return {
      status: "requires_governance",
      actionType: request.actionType ?? CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
      request: publicCircleSeededGovernanceRequest(request),
    };
  }

  const payload = await input.buildPayload();
  const request = await gateway.openRequest({
    actionType: CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
    targetCircleId: input.circleId,
    targetType: "circle",
    targetRef: String(input.circleId),
    payload: {
      ...payload,
      actorPubkey: input.actorPubkey,
    },
    idempotencyKey,
    proposerPubkey: input.actorPubkey,
  });

  return {
    status: "requires_governance",
    actionType: CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
    request: publicCircleSeededGovernanceRequest(request),
  };
}

export async function executeCircleSeededGovernanceAction(
  prisma: PrismaClient,
  redis: Redis | null,
  request: {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
  },
): Promise<{
  executionStatus: "executed" | "skipped";
  executionRef: string | null;
  errorCode?: string | null;
} | null> {
  if (request.actionType !== CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE) {
    return null;
  }
  if (request.targetType !== "circle") return null;
  const circleId = Number(request.targetRef);
  if (!Number.isInteger(circleId) || circleId <= 0) {
    throw new Error("invalid_circle_seeded_target");
  }
  const payload = normalizeRecord(request.payload);
  if (payload.operation !== "replace_manifest") {
    throw new Error("invalid_seeded_governance_operation");
  }

  const files = await loadStagedSeededFiles(payload.stagedFiles);
  if (files.length === 0) {
    throw new Error("seeded_files_required");
  }

  await importSeededSources(prisma, {
    circleId,
    files,
  });

  try {
    await markCircleTopicProfileDirty({
      prisma,
      redis: redis as Redis,
      circleId,
      reason: "seeded_import_completed",
    });
  } catch {
    // best effort only
  }

  return {
    executionStatus: "executed",
    executionRef: String(circleId),
  };
}

async function findActiveCircleSeededRequest(
  prisma: {
    governanceRequest: {
      findFirst(input: unknown): Promise<unknown | null>;
    };
  },
  input: {
    circleId: number;
    idempotencyKey: string;
    committeeCircleId: number;
  },
): Promise<unknown | null> {
  return prisma.governanceRequest.findFirst({
    where: {
      actionType: CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
      targetType: "circle",
      targetRef: String(input.circleId),
      scopeType: "circle_governance_committee",
      scopeRef: String(input.committeeCircleId),
      state: "active",
      idempotencyKey: input.idempotencyKey,
    },
    include: {
      snapshot: true,
    },
  });
}

async function loadStagedSeededFiles(value: unknown): Promise<SeededImportFileInput[]> {
  if (!Array.isArray(value)) {
    throw new Error("seeded_staged_files_required");
  }
  const files: SeededImportFileInput[] = [];
  for (const item of value) {
    const record = normalizeRecord(item);
    if (record.nodeType !== "file") continue;
    const path = typeof record.path === "string" ? record.path : "";
    const locator = typeof record.contentLocator === "string" ? record.contentLocator : "";
    if (!path || !locator) {
      throw new Error("invalid_seeded_staged_file");
    }
    const content = await loadPrivateText(locator);
    if (content === null) {
      throw new Error("seeded_staged_file_missing");
    }
    files.push({
      path,
      content,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
    });
  }
  return files;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
